import { GoogleGenerativeAI } from "@google/generative-ai";
import Hotel from "../models/Hotel.js";
import Room from "../models/Room.js";
import Booking from "../models/Booking.js";
import User from "../models/User.js";
import transporter from "../configs/nodemailer.js";
import { checkAvailability } from "./bookingController.js";

// Initialize Gemini AI client
if (!process.env.GEMINI_API_KEY) {
  console.warn("Warning: GEMINI_API_KEY is not set in environment variables");
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// System prompt for the AI agent
const SYSTEM_PROMPT = `You are a helpful AI assistant for a hotel booking application. Your role is to help users:
1. Search for hotels and rooms
2. Check room availability for specific dates
3. Book hotels/rooms
4. Answer questions about hotels, rooms, and bookings

When users ask about:
- Searching hotels: Extract location/city, room type, price range, amenities
- Checking availability: Extract room ID, check-in date, check-out date
- Booking: Extract room ID, check-in date, check-out date, number of guests
- General questions: Provide helpful information

Always respond in a friendly, conversational manner. When you need specific information (like dates, room IDs, etc.), ask the user clearly.`;

// Function to search hotels and rooms
const searchHotels = async (query) => {
  try {
    const { city, roomType, priceRange, amenities } = query;
    
    let searchQuery = { isAvailable: true };
    
    if (city) {
      const hotels = await Hotel.find({ city: new RegExp(city, "i") });
      const hotelIds = hotels.map(h => h._id.toString());
      searchQuery.hotel = { $in: hotelIds };
    }
    
    if (roomType) {
      searchQuery.roomType = new RegExp(roomType, "i");
    }
    
    if (priceRange) {
      if (priceRange.min) searchQuery.pricePerNight = { $gte: priceRange.min };
      if (priceRange.max) {
        searchQuery.pricePerNight = { 
          ...searchQuery.pricePerNight, 
          $lte: priceRange.max 
        };
      }
    }
    
    if (amenities && amenities.length > 0) {
      searchQuery.amenities = { $in: amenities };
    }
    
    const rooms = await Room.find(searchQuery)
      .populate({
        path: 'hotel',
        populate: {
          path: 'owner',
          select: 'image',
        },
      })
      .limit(10);
    
    return rooms;
  } catch (error) {
    console.error("Error searching hotels:", error);
    return [];
  }
};

// Function to format room data for AI response
const formatRoomsForAI = (rooms) => {
  if (!rooms || rooms.length === 0) {
    return "No hotels or rooms found matching your criteria.";
  }
  
  let response = `I found ${rooms.length} room(s) for you:\n\n`;
  
  rooms.forEach((room, index) => {
    response += `${index + 1}. **${room.hotel.name}**\n`;
    response += `   - Location: ${room.hotel.address}, ${room.hotel.city}\n`;
    response += `   - Room Type: ${room.roomType}\n`;
    response += `   - Price: ₹${room.pricePerNight}/night\n`;
    response += `   - Amenities: ${room.amenities.join(", ")}\n`;
    response += `   - Room ID: ${room._id}\n\n`;
  });
  
  response += "Would you like to check availability or book any of these rooms?";
  
  return response;
};

// Main AI agent function
export const chatWithAI = async (req, res) => {
  try {
    const { message, conversationHistory = [] } = req.body;
    const userId = req.auth?.userId;
    
    if (!message) {
      return res.json({ 
        success: false, 
        message: "Message is required" 
      });
    }
    
    // Build conversation history for context
    const conversationContext = conversationHistory.slice(-10).map(msg => {
      if (msg.role === "user") {
        return `User: ${msg.content}`;
      } else {
        return `Assistant: ${msg.content}`;
      }
    }).join("\n");
    
    // Use Gemini to understand user intent and extract information
    // Default to gemini-2.5-flash, can be overridden via env variable
    // Fallback models: gemini-2.5-flash -> gemini-1.5-flash -> gemini-pro
    let modelName = process.env.GEMINI_MODEL_NAME || "gemini-2.5-flash";
    let model = genAI.getGenerativeModel({ model: modelName });
    
    const prompt = `${SYSTEM_PROMPT}

You are an AI assistant that helps users with hotel bookings. Analyze the user's message and determine their intent. Respond with a JSON object containing:
{
  "intent": "search" | "check_availability" | "book" | "question" | "greeting",
  "extractedData": {
    "city": "string or null",
    "roomType": "string or null",
    "checkInDate": "string or null (YYYY-MM-DD format)",
    "checkOutDate": "string or null (YYYY-MM-DD format)",
    "roomId": "string or null",
    "guests": "number or null",
    "priceRange": {"min": number or null, "max": number or null},
    "amenities": ["string"] or null
  },
  "needsClarification": ["list of missing information"],
  "response": "A friendly natural language response to the user"
}

${conversationContext ? `Previous conversation:\n${conversationContext}\n\n` : ""}User message: ${message}

Respond only with valid JSON, no additional text.`;

    // Add retry logic for network errors with model fallback
    let result;
    let retries = 3;
    let lastError;
    const fallbackModels = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-pro"];
    let currentModelIndex = fallbackModels.indexOf(modelName) >= 0 ? fallbackModels.indexOf(modelName) : 0;
    let currentModel = model;
    
    while (retries > 0) {
      try {
        result = await currentModel.generateContent(prompt);
        break; // Success, exit retry loop
      } catch (error) {
        lastError = error;
        
        // If model not found, try fallback models
        if (error.message && error.message.includes("404") && error.message.includes("model") && currentModelIndex < fallbackModels.length - 1) {
          currentModelIndex++;
          const newModelName = fallbackModels[currentModelIndex];
          currentModel = genAI.getGenerativeModel({ model: newModelName });
          console.log(`Model "${modelName}" not found, trying fallback: ${newModelName}`);
          modelName = newModelName; // Update for logging
          continue;
        }
        
        // Only retry on network errors, not on API errors
        if (error.message && (error.message.includes("fetch failed") || error.message.includes("ECONNREFUSED") || error.message.includes("ENOTFOUND")) && retries > 1) {
          console.log(`Network error, retrying Gemini API call... (${retries - 1} retries left)`);
          retries--;
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
          continue;
        } else {
          throw error; // Re-throw if not a network error or no retries left
        }
      }
    }
    
    if (!result) {
      throw lastError || new Error("Failed to get response from AI");
    }
    
    const response = await result.response;
    const text = response.text();
    
    // Parse JSON response (remove markdown code blocks if present)
    let jsonText = text.trim();
    if (jsonText.startsWith("```json")) {
      jsonText = jsonText.replace(/```json\n?/g, "").replace(/```\n?/g, "");
    } else if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/```\n?/g, "");
    }
    
    let aiAnalysis;
    try {
      aiAnalysis = JSON.parse(jsonText);
    } catch (parseError) {
      console.error("JSON Parse Error:", parseError);
      console.error("Response text:", jsonText);
      throw new Error("Failed to parse AI response. The AI returned invalid JSON. Please try again.");
    }
    let aiResponse = aiAnalysis.response;
    let actionData = null;
    
    // Handle different intents
    switch (aiAnalysis.intent) {
      case "search":
        if (aiAnalysis.needsClarification.length === 0) {
          const rooms = await searchHotels(aiAnalysis.extractedData);
          aiResponse = formatRoomsForAI(rooms);
          actionData = { type: "search_results", rooms: rooms.map(r => ({
            id: r._id,
            hotelName: r.hotel.name,
            address: r.hotel.address,
            city: r.hotel.city,
            roomType: r.roomType,
            pricePerNight: r.pricePerNight,
            amenities: r.amenities,
            images: r.images
          })) };
        }
        break;
        
      case "check_availability":
        if (aiAnalysis.extractedData.roomId && 
            aiAnalysis.extractedData.checkInDate && 
            aiAnalysis.extractedData.checkOutDate) {
          const isAvailable = await checkAvailability({
            room: aiAnalysis.extractedData.roomId,
            checkInDate: new Date(aiAnalysis.extractedData.checkInDate),
            checkOutDate: new Date(aiAnalysis.extractedData.checkOutDate)
          });
          
          if (isAvailable) {
            const room = await Room.findById(aiAnalysis.extractedData.roomId).populate("hotel");
            const checkIn = new Date(aiAnalysis.extractedData.checkInDate);
            const checkOut = new Date(aiAnalysis.extractedData.checkOutDate);
            const nights = Math.ceil((checkOut - checkIn) / (1000 * 3600 * 24));
            const totalPrice = room.pricePerNight * nights;
            
            aiResponse = `Great news! The room is available for those dates.\n\n`;
            aiResponse += `**${room.hotel.name}** - ${room.roomType}\n`;
            aiResponse += `Check-in: ${checkIn.toDateString()}\n`;
            aiResponse += `Check-out: ${checkOut.toDateString()}\n`;
            aiResponse += `Nights: ${nights}\n`;
            aiResponse += `Total Price: ₹${totalPrice}\n\n`;
            aiResponse += `Would you like to proceed with the booking?`;
            
            actionData = {
              type: "availability_check",
              isAvailable: true,
              roomId: room._id,
              hotelName: room.hotel.name,
              checkInDate: aiAnalysis.extractedData.checkInDate,
              checkOutDate: aiAnalysis.extractedData.checkOutDate,
              totalPrice,
              nights
            };
          } else {
            aiResponse = `I'm sorry, but this room is not available for the selected dates. Would you like me to search for alternative rooms?`;
            actionData = {
              type: "availability_check",
              isAvailable: false
            };
          }
        }
        break;
        
      case "book":
        if (!userId) {
          aiResponse = "You need to be logged in to make a booking. Please log in first.";
        } else if (aiAnalysis.needsClarification.length === 0) {
          // The actual booking will be handled by the booking API
          // Here we just confirm the booking details
          const room = await Room.findById(aiAnalysis.extractedData.roomId).populate("hotel");
          if (room) {
            const checkIn = new Date(aiAnalysis.extractedData.checkInDate);
            const checkOut = new Date(aiAnalysis.extractedData.checkOutDate);
            const nights = Math.ceil((checkOut - checkIn) / (1000 * 3600 * 24));
            const totalPrice = room.pricePerNight * nights;
            
            aiResponse = `Perfect! I can help you book this room.\n\n`;
            aiResponse += `**Booking Summary:**\n`;
            aiResponse += `Hotel: ${room.hotel.name}\n`;
            aiResponse += `Room Type: ${room.roomType}\n`;
            aiResponse += `Check-in: ${checkIn.toDateString()}\n`;
            aiResponse += `Check-out: ${checkOut.toDateString()}\n`;
            aiResponse += `Guests: ${aiAnalysis.extractedData.guests || 1}\n`;
            aiResponse += `Total Price: ₹${totalPrice}\n\n`;
            aiResponse += `Should I proceed with the booking?`;
            
            actionData = {
              type: "booking_confirmation",
              roomId: room._id,
              hotelName: room.hotel.name,
              checkInDate: aiAnalysis.extractedData.checkInDate,
              checkOutDate: aiAnalysis.extractedData.checkOutDate,
              guests: aiAnalysis.extractedData.guests || 1,
              totalPrice
            };
          }
        }
        break;
        
      case "greeting":
        aiResponse = "Hello! I'm your AI assistant for hotel bookings. I can help you:\n- Search for hotels and rooms\n- Check room availability\n- Make bookings\n\nHow can I assist you today?";
        break;
        
      default:
        // For questions and general queries, use the AI response
        break;
    }
    
    // If clarification is needed, mention it in the response
    if (aiAnalysis.needsClarification.length > 0) {
      aiResponse += `\n\nI need a bit more information: ${aiAnalysis.needsClarification.join(", ")}`;
    }
    
    res.json({
      success: true,
      message: aiResponse,
      actionData,
      intent: aiAnalysis.intent
    });
    
  } catch (error) {
    console.error("AI Agent Error:", error);
    console.error("Error details:", {
      message: error.message,
      status: error.status,
      statusText: error.statusText,
      stack: error.stack
    });
    
    // Check for API key issues
    if (!process.env.GEMINI_API_KEY) {
      return res.json({
        success: false,
        message: "AI service is not configured. Please set GEMINI_API_KEY in your environment variables."
      });
    }
    
    // Handle network/fetch errors
    if (error.message && (error.message.includes("fetch failed") || error.message.includes("ECONNREFUSED") || error.message.includes("ENOTFOUND"))) {
      return res.json({
        success: false,
        message: "Unable to connect to AI service. Please check your internet connection and API key."
      });
    }
    
    // Provide more helpful error message for model issues
    if (error.message && error.message.includes("404") && error.message.includes("model")) {
      return res.json({
        success: false,
        message: `AI model not found. Please check if "${process.env.GEMINI_MODEL_NAME || "gemini-2.0-flash-exp"}" is a valid model name.`
      });
    }
    
    // Handle authentication errors
    if (error.status === 401 || error.status === 403) {
      return res.json({
        success: false,
        message: "AI service authentication failed. Please check your GEMINI_API_KEY."
      });
    }
    
    res.json({
      success: false,
      message: "I'm sorry, I encountered an error. Please try again or rephrase your question."
    });
  }
};

// Function to create booking through AI agent
export const createBookingViaAI = async (req, res) => {
  try {
    const { roomId, checkInDate, checkOutDate, guests } = req.body;
    const userId = req.auth?.userId;

    if (!userId) {
      return res.json({ 
        success: false, 
        message: "You need to be logged in to make a booking" 
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.json({ 
        success: false, 
        message: "User not found" 
      });
    }

    // Check availability
    const isAvailable = await checkAvailability({
      room: roomId,
      checkInDate: new Date(checkInDate),
      checkOutDate: new Date(checkOutDate)
    });

    if (!isAvailable) {
      return res.json({ 
        success: false, 
        message: "Room is not available for the selected dates" 
      });
    }

    // Get room data
    const roomData = await Room.findById(roomId).populate("hotel");
    if (!roomData) {
      return res.json({ 
        success: false, 
        message: "Room not found" 
      });
    }

    // Calculate total price
    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);
    const timeDiff = checkOut.getTime() - checkIn.getTime();
    const nights = Math.ceil(timeDiff / (1000 * 3600 * 24));
    const totalPrice = roomData.pricePerNight * nights;

    // Create booking
    const booking = await Booking.create({
      user: userId,
      room: roomId,
      hotel: roomData.hotel._id,
      guests: +guests || 1,
      checkInDate,
      checkOutDate,
      totalPrice,
    });

    // Send confirmation email
    try {
      const mailOptions = {
        from: process.env.SENDER_EMAIL,
        to: user.email,
        subject: 'Hotel Booking Details',
        html: `
          <h2>Your Booking Details</h2>
          <p>Dear ${user.username || user.email},</p>
          <p>Thank you for your booking! Here are your details:</p>
          <ul>
            <li><strong>Booking ID:</strong> ${booking._id}</li>
            <li><strong>Hotel Name:</strong> ${roomData.hotel.name}</li>
            <li><strong>Location:</strong> ${roomData.hotel.address}</li>
            <li><strong>Check-in:</strong> ${checkIn.toDateString()}</li>
            <li><strong>Check-out:</strong> ${checkOut.toDateString()}</li>
            <li><strong>Booking Amount:</strong> ${process.env.CURRENCY || '₹'} ${totalPrice}</li>
          </ul>
          <p>We look forward to welcoming you!</p>
          <p>If you need to make any changes, feel free to contact us.</p>
        `,
      };
      await transporter.sendMail(mailOptions);
    } catch (emailError) {
      console.error("Email sending error:", emailError);
      // Don't fail the booking if email fails
    }

    res.json({ 
      success: true, 
      message: "Booking created successfully!",
      booking: {
        id: booking._id,
        bookingId: booking._id.toString(),
        hotelName: roomData.hotel.name,
        checkInDate: checkIn.toDateString(),
        checkOutDate: checkOut.toDateString(),
        totalPrice,
        nights
      }
    });

  } catch (error) {
    console.error("AI Booking Error:", error);
    res.json({
      success: false,
      message: "Failed to create booking. Please try again."
    });
  }
};

