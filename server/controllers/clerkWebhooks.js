import { Webhook } from "svix";
import User from "../models/User.js";

// POST /api/clerk
const clerkWebhooks = async (req, res) => {
  try {
    const whook = new Webhook(process.env.CLERK_WEBHOOK_SECRET);

    const headers = {
      "svix-id": req.headers["svix-id"],
      "svix-timestamp": req.headers["svix-timestamp"],
      "svix-signature": req.headers["svix-signature"],
    };

    // Verify signature
    await whook.verify(JSON.stringify(req.body), headers);

    const { data, type } = req.body;

    // Prepare user data safely
    const userData = {
      _id: data.id,
      email: data.email_addresses?.[0]?.email_address || "unknown@example.com",
      username: `${data.first_name || ""} ${data.last_name || ""}`.trim() || "Unknown User",
      image: data.image_url || "https://example.com/default-avatar.png",
      role: "user",
      recentSearchedCities: [],
    };

    // Handle different event types
    switch (type) {
      case "user.created":
        // Upsert to prevent duplicate errors
        await User.findOneAndUpdate(
          { _id: data.id },
          userData,
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        break;

      case "user.updated":
        await User.findByIdAndUpdate(data.id, userData, { new: true });
        break;

      case "user.deleted":
        await User.findByIdAndDelete(data.id);
        break;

      default:
        break;
    }

    res.json({ success: true, message: "Webhook received" });
  } catch (error) {
    console.error("Clerk webhook error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

export default clerkWebhooks;
