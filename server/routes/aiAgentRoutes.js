import express from "express";
import { chatWithAI, createBookingViaAI } from "../controllers/aiAgentController.js";
import { stripePayment } from "../controllers/bookingController.js";
import { clerkMiddleware } from "@clerk/express";
import { protect } from "../middleware/authMiddleware.js";

const aiAgentRouter = express.Router();

// AI chat endpoint - optional authentication (for booking functionality)
aiAgentRouter.post("/chat", clerkMiddleware(), chatWithAI);

// Create booking through AI agent
aiAgentRouter.post("/book", clerkMiddleware(), protect, createBookingViaAI);

// Payment endpoint for AI bookings
aiAgentRouter.post("/payment", clerkMiddleware(), protect, stripePayment);

export default aiAgentRouter;

