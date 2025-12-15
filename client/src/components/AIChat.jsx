import React, { useState, useRef, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import toast from 'react-hot-toast';
import { assets } from '../assets/assets';

const AIChat = ({ isOpen, onClose }) => {
  const { axios, getToken, user, navigate } = useAppContext();
  const initialMessage = {
    role: 'assistant',
    content: "Hello! I'm your AI assistant for hotel bookings. I can help you:\n- Search for hotels and rooms\n- Check room availability\n- Make bookings\n\nHow can I assist you today?",
    timestamp: new Date()
  };

  const [messages, setMessages] = useState([initialMessage]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [messages, isOpen]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim() || isLoading) return;

    const userMessage = inputMessage.trim();
    setInputMessage('');
    
    // Add user message to chat
    const newUserMessage = {
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, newUserMessage]);
    setIsLoading(true);

    try {
      // Build conversation history
      const conversationHistory = [...messages, newUserMessage].map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      // Call AI API
      const token = user ? await getToken() : null;
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      
      const { data } = await axios.post('/api/ai/chat', {
        message: userMessage,
        conversationHistory: conversationHistory.slice(0, -1) // Exclude current message
      }, { headers });

      if (data.success) {
        // Add AI response
        const aiMessage = {
          role: 'assistant',
          content: data.message,
          timestamp: new Date(),
          actionData: data.actionData
        };
        setMessages(prev => [...prev, aiMessage]);

        // Handle action data (like booking confirmation)
        if (data.actionData) {
          handleActionData(data.actionData);
        }
      } else {
        toast.error(data.message || 'Failed to get response');
      }
    } catch (error) {
      console.error('AI Chat Error:', error);
      toast.error('Failed to send message. Please try again.');
      const errorMessage = {
        role: 'assistant',
        content: "I'm sorry, I encountered an error. Please try again.",
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleActionData = async (actionData) => {
    if (actionData.type === 'booking_confirmation') {
      // Store booking data for confirmation
      // User will confirm in chat
    } else if (actionData.type === 'search_results' && actionData.rooms) {
      // User can click on rooms to view details
      // The AI response already includes room information
    } else if (actionData.type === 'availability_check' && actionData.isAvailable) {
      // Room is available, user can proceed to book
    }
  };

  const handleConfirmBooking = async (bookingData) => {
    if (!user) {
      toast.error('Please log in to make a booking');
      return;
    }

    setIsLoading(true);
    try {
      const token = await getToken();
      const { data } = await axios.post('/api/ai/book', {
        roomId: bookingData.roomId,
        checkInDate: bookingData.checkInDate,
        checkOutDate: bookingData.checkOutDate,
        guests: bookingData.guests || 1
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (data.success) {
        const successMessage = {
          role: 'assistant',
          content: `🎉 Booking confirmed!\n\n**Booking Details:**\n- Hotel: ${data.booking.hotelName}\n- Check-in: ${data.booking.checkInDate}\n- Check-out: ${data.booking.checkOutDate}\n- Total: ${data.booking.totalPrice} ₹\n\nYour booking ID is: ${data.booking.id}\n\nWould you like to make a payment now?`,
          timestamp: new Date(),
          actionData: {
            type: 'booking_success',
            bookingId: data.booking.bookingId || data.booking.id,
            totalPrice: data.booking.totalPrice
          }
        };
        setMessages(prev => [...prev, successMessage]);
        toast.success('Booking created successfully!');
      } else {
        toast.error(data.message || 'Failed to create booking');
      }
    } catch (error) {
      console.error('Booking Error:', error);
      toast.error('Failed to create booking. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePayment = async (bookingId) => {
    if (!user) {
      toast.error('Please log in to make a payment');
      return;
    }

    setIsLoading(true);
    try {
      const token = await getToken();
      const { data } = await axios.post('/api/ai/payment', {
        bookingId: bookingId
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (data.success && data.url) {
        // Redirect to Stripe checkout
        window.location.href = data.url;
      } else {
        toast.error(data.message || 'Failed to initiate payment');
      }
    } catch (error) {
      console.error('Payment Error:', error);
      toast.error('Failed to initiate payment. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefreshChat = () => {
    setMessages([{
      ...initialMessage,
      timestamp: new Date()
    }]);
    setInputMessage('');
    toast.success('Chat refreshed! Starting a new conversation.');
  };

  const handleQuickAction = async (action) => {
    let message = '';
    switch (action) {
      case 'search':
        message = 'Show me available hotels';
        break;
      case 'availability':
        message = 'How do I check room availability?';
        break;
      case 'book':
        message = 'I want to book a hotel room';
        break;
      default:
        return;
    }
    setInputMessage(message);
    // Trigger send after a brief delay to allow state update
    setTimeout(() => {
      const form = document.querySelector('form');
      if (form) {
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }
    }, 100);
  };

  const formatMessage = (content) => {
    // Convert markdown-style formatting to HTML
    const lines = content.split('\n');
    return lines.map((line, index) => {
      // Bold text
      const boldRegex = /\*\*(.*?)\*\*/g;
      let formattedLine = line.replace(boldRegex, '<strong>$1</strong>');
      
      // Room ID links (if user is logged in)
      if (user) {
        const roomIdRegex = /Room ID: ([a-f0-9]{24})/gi;
        formattedLine = formattedLine.replace(roomIdRegex, (match, roomId) => {
          return `Room ID: <span class="text-blue-600 cursor-pointer underline" onclick="window.location.href='/rooms/${roomId}'">${roomId}</span>`;
        });
      }
      
      return (
        <React.Fragment key={index}>
          <span dangerouslySetInnerHTML={{ __html: formattedLine }} />
          {index < lines.length - 1 && <br />}
        </React.Fragment>
      );
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed right-0 top-0 bottom-0 z-50 flex items-start animate-slide-in-right">
      <div 
        className="bg-white shadow-2xl w-full max-w-md md:max-w-lg h-full flex flex-col overflow-hidden border-l border-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-lg">AI Booking Assistant</h3>
              <p className="text-xs text-blue-100">Ask me anything about hotels!</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Refresh Button */}
            <button
              onClick={handleRefreshChat}
              className="text-white hover:bg-white/20 rounded-full p-2 transition-colors"
              title="Refresh Chat"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            {/* Close Button */}
            <button
              onClick={onClose}
              className="text-white hover:bg-white/20 rounded-full p-2 transition-colors"
              title="Close Chat"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  message.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-800 shadow-sm border border-gray-200'
                }`}
              >
                <div className="text-sm whitespace-pre-wrap">
                  {formatMessage(message.content)}
                </div>
                {message.actionData && message.actionData.type === 'booking_confirmation' && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <button
                      onClick={() => handleConfirmBooking(message.actionData)}
                      disabled={isLoading || !user}
                      className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                    >
                      {isLoading ? 'Processing...' : user ? 'Confirm Booking' : 'Login to Book'}
                    </button>
                  </div>
                )}
                {message.actionData && message.actionData.type === 'booking_success' && (
                  <div className="mt-3 pt-3 border-t border-gray-200 space-y-2">
                    <div className="bg-blue-50 p-3 rounded-lg text-xs text-blue-800 mb-2">
                      <p className="font-semibold mb-1">💳 Test Card for Payment:</p>
                      <p>Card: 4242 4242 4242 4242</p>
                      <p>Expiry: Any future date (e.g., 12/25)</p>
                      <p>CVC: Any 3 digits (e.g., 123)</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handlePayment(message.actionData.bookingId)}
                        disabled={isLoading}
                        className="flex-1 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                      >
                        {isLoading ? 'Processing...' : '💳 Pay Now'}
                      </button>
                      <button
                        onClick={() => {
                          const skipMessage = {
                            role: 'assistant',
                            content: 'No problem! You can pay later from the "My Bookings" section. Your booking is confirmed!',
                            timestamp: new Date()
                          };
                          setMessages(prev => [...prev, skipMessage]);
                        }}
                        disabled={isLoading}
                        className="flex-1 bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300 disabled:bg-gray-100 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                      >
                        Pay Later
                      </button>
                    </div>
                  </div>
                )}
                {message.actionData && message.actionData.type === 'availability_check' && message.actionData.isAvailable && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <button
                      onClick={() => {
                        const bookingMsg = `I want to book room ${message.actionData.roomId} for ${message.actionData.checkInDate} to ${message.actionData.checkOutDate}`;
                        setInputMessage(bookingMsg);
                        setTimeout(() => {
                          const form = document.querySelector('form');
                          if (form) {
                            form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                          }
                        }, 100);
                      }}
                      disabled={isLoading || !user}
                      className="w-full bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                    >
                      {user ? 'Book This Room' : 'Login to Book'}
                    </button>
                  </div>
                )}
                <div className={`text-xs mt-1 ${message.role === 'user' ? 'text-blue-100' : 'text-gray-500'}`}>
                  {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}
          
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white text-gray-800 rounded-2xl px-4 py-3 shadow-sm border border-gray-200">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Quick Actions */}
        {messages.length === 1 && (
          <div className="px-4 py-2 bg-gray-100 border-t border-gray-200">
            <p className="text-xs text-gray-600 mb-2">Quick actions:</p>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => handleQuickAction('search')}
                className="px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-full hover:bg-gray-50 transition-colors"
              >
                🔍 Search Hotels
              </button>
              <button
                onClick={() => handleQuickAction('availability')}
                className="px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-full hover:bg-gray-50 transition-colors"
              >
                📅 Check Availability
              </button>
              <button
                onClick={() => handleQuickAction('book')}
                className="px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-full hover:bg-gray-50 transition-colors"
              >
                🏨 Book Room
              </button>
            </div>
          </div>
        )}

        {/* Input */}
        <form onSubmit={handleSendMessage} className="p-4 bg-white border-t border-gray-200">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder="Type your message..."
              className="flex-1 px-4 py-3 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={!inputMessage.trim() || isLoading}
              className="bg-blue-600 text-white px-6 py-3 rounded-full hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
            >
              {isLoading ? (
                <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AIChat;

