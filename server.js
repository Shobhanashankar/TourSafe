import express from "express";
import dotenv from "dotenv";
import morgan from "morgan";
import cors from "cors";
import bodyParser from "body-parser";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { Server } from "socket.io";
import http from "http";
import winston from "winston";
import Sentry from "@sentry/node";
import admin from "firebase-admin";
import twilio from "twilio";

dotenv.config();
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(morgan("dev"));

// Sentry Initialization
Sentry.init({ dsn: process.env.SENTRY_DSN });

// Winston Logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});

// Firebase Initialization
if (process.env.FCM_KEY) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FCM_KEY)),
  });
}

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => logger.info("✅ MongoDB connected"))
.catch((err) => {
  logger.error("❌ MongoDB connection error:", err);
  Sentry.captureException(err);
});

// Schemas
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true },
  password: { type: String, required: true },
  nationality: String,
  emergencyContacts: [String],
  deviceToken: String,
}, { timestamps: true });
const User = mongoose.model("User", userSchema);

const itinerarySchema = new mongoose.Schema({
  userId: String,
  locations: [Object],
});
const Itinerary = mongoose.model("Itinerary", itinerarySchema);

const alertSchema = new mongoose.Schema({
  userId: String,
  location: Object,
  type: String,
  timestamp: { type: Date, default: Date.now },
});
const Alert = mongoose.model("Alert", alertSchema);

const penaltySchema = new mongoose.Schema({
  userId: String,
  type: String,
  pointsDeducted: Number,
  timestamp: { type: Date, default: Date.now },
  blockchainHash: String,
});
const Penalty = mongoose.model("Penalty", penaltySchema);

// Authentication Middleware
const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (error) {
    Sentry.captureException(error);
    res.status(401).json({ error: "Invalid token" });
  }
};

// Routes
app.post("/api/users/signup", async (req, res) => {
  try {
    const { name, email, password, nationality, emergencyContacts } = req.body;
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ success: false, message: "User already exists" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    user = await User.create({
      name,
      email,
      password: hashedPassword,
      nationality,
      emergencyContacts,
    });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
    res.status(201).json({
      success: true,
      message: "User registered successfully",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        nationality: user.nationality,
        emergencyContacts: user.emergencyContacts,
      },
    });
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

app.post("/api/users/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ success: false, message: "Invalid email or password" });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Invalid email or password" });
    }
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        nationality: user.nationality,
        emergencyContacts: user.emergencyContacts,
      },
    });
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

app.post("/api/register-device", authenticateToken, async (req, res) => {
  try {
    const { token } = req.body;
    await User.updateOne({ _id: req.userId }, { $set: { deviceToken: token } });
    res.json({ success: true });
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/panic-alert", authenticateToken, async (req, res) => {
  try {
    const alert = new Alert({ ...req.body, userId: req.userId });
    await alert.save();
    io.emit("panic", req.body);
    const user = await User.findById(req.userId);
    if (process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_PHONE && user.emergencyContacts.length > 0) {
      const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
      await client.messages.create({
        body: `Panic at ${req.body.location.lat},${req.body.location.lng}! 📍`,
        from: process.env.TWILIO_PHONE,
        to: user.emergencyContacts[0],
      });
    }
    if (process.env.FCM_KEY && user.deviceToken) {
      await admin.messaging().send({
        notification: { title: "Panic Alert", body: "🚨" },
        token: user.deviceToken,
      });
    }
    res.json({ color: "red", tip: "Help is on the way!" });
  } catch (error) {
    Sentry.captureException(error);
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/emergency-numbers", (req, res) => {
  try {
    const { lat, lng } = req.query;
    const mockEmergencyNumbers = [
      { type: "Fire", name: "Assam Fire Service", phone: "101", lat: 26.1445, lng: 91.7362, distance: 2.5 },
      { type: "Ambulance", name: "Assam Ambulance", phone: "108", lat: 26.1445, lng: 91.7362, distance: 1.8 },
      { type: "Hospital", name: "Guwahati Medical College", phone: "+913612345678", lat: 26.1445, lng: 91.7362, distance: 3.2 },
      { type: "Dispensary", name: "City Dispensary", phone: "+913612345679", lat: 26.1445, lng: 91.7362, distance: 0.9 },
      { type: "Medical Shop", name: "Health Pharmacy", phone: "+913612345680", lat: 26.1445, lng: 91.7362, distance: 1.2 },
    ];
    const services = mockEmergencyNumbers.map(service => ({
      ...service,
      distance: Math.sqrt(
        Math.pow(service.lat - parseFloat(lat), 2) + Math.pow(service.lng - parseFloat(lng), 2)
      ).toFixed(1),
    }));
    res.json(services);
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/penalty/add-penalty", authenticateToken, async (req, res) => {
  try {
    const penalty = new Penalty({
      userId: req.userId,
      type: req.body.type,
      pointsDeducted: req.body.points,
      blockchainHash: `mock-hash-${Date.now()}`,
    });
    await penalty.save();
    res.json({ success: true, penalty });
  } catch (error) {
    Sentry.captureException(error);
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/penalty/penalties", authenticateToken, async (req, res) => {
  try {
    const penalties = await Penalty.find({ userId: req.userId });
    res.json(penalties);
  } catch (error) {
    Sentry.captureException(error);
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/profile", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    const itinerary = await Itinerary.find({ userId: req.userId });
    res.json({ user, itinerary });
  } catch (error) {
    Sentry.captureException(error);
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/track-location", authenticateToken, async (req, res) => {
  try {
    io.emit("location-update", req.body);
    res.json({ success: true });
  } catch (error) {
    Sentry.captureException(error);
    res.status(400).json({ error: error.message });
  }
});

app.get("/", (req, res) => {
  res.send("Tourist Backend API is running...");
});

io.on("connection", (socket) => {
  logger.info("User connected");
  socket.on("disconnect", () => logger.info("User disconnected"));
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  logger.info(`🚀 Server running on http://localhost:${PORT}`);
});