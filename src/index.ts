import cookieParser from "cookie-parser";
import cors from "cors";
import "dotenv/config";
import express from "express";
import { errorHandler } from "./middleware/errorHandler";
import AdvertisementRouter from "./routers/advertisement";
import AuthRouter from "./routers/auth";
import CartRouter from "./routers/cart";
import ProductRouter from "./routers/product";
import TreasureBoxRouter from "./routers/treasureBox";
import ChatroomRouter from "./routers/chatroom";
import dailyTask from "./lib/scheduler";

const app = express();
const PORT = process.env.PORT ?? 4000;

dailyTask.start(); // Start the scheduled task
console.log("Cron job has been started.");

app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true })); // Middleware for parsing form data

app.use(cors());

app.post("/api/protected/test", (_, res) => {
  res.send({
    success: true,
    data: "Here is some protected information from the server",
  });
});

app.use("/api/auth", AuthRouter);
app.use("/api/treasureBox", TreasureBoxRouter);
app.use("/api/advertisement", AdvertisementRouter);
app.use("/api/product", ProductRouter);
app.use("/api/cart", CartRouter);
app.use("/api/chatroom", ChatroomRouter);

app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
