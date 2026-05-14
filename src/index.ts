// Make sure to import environment variables at the very beginning
import "./lib/env";

import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import {
  dailyNotificationTask,
  dailyResetTask,
  deleteUnusedDeviceTokensTask,
  expireOrdersTask,
  fetchEcPayStoreListTask,
  monthlyCoinExpirationNotificationTask,
  monthlyCoinStatExpirationTask,
  pollLogisticsTradeInfoTask,
} from "./lib/scheduler";
import { swaggerSpec } from "./lib/swagger";
import { errorHandler } from "./middleware/errorHandler";
import AdminRouter from "./routers/admin";
import AdvertisementRouter from "./routers/advertisement";
import AuthRouter from "./routers/auth";
import CartRouter from "./routers/cart";
import ChatroomRouter from "./routers/chatroom";
import CollectionRouter from "./routers/collection";
import DeliveryRouter from "./routers/delivery";
import EcPayRouter from "./routers/ecpay";
import FileRouter from "./routers/file";
import NotificationRouter from "./routers/notification";
import OrderRouter from "./routers/order";
import ProductRouter from "./routers/product";
import TreasureBoxRouter from "./routers/treasureBox";

console.log(`HOST: ${process.env.HOST}`);

const app = express();
const PORT = process.env.PORT ?? 4000;

// pollEcPayLogisticsTradeInfo();

// Start the scheduled task
dailyResetTask.start();
dailyNotificationTask.start();
monthlyCoinStatExpirationTask.start();
monthlyCoinExpirationNotificationTask.start();
deleteUnusedDeviceTokensTask.start();
expireOrdersTask.start();
pollLogisticsTradeInfoTask.start();
fetchEcPayStoreListTask.start();

console.log("Cron job has been started.");

// Increase payload size limit for JSON and URL-encoded bodies
// Adjust '50mb' to a value that suits your needs, matching or exceeding Nginx's limit.
app.use(express.json({ limit: "50mb" }));
app.use(cookieParser());
app.use(express.urlencoded({ limit: "50mb", extended: true })); // Middleware for parsing form data

app.use(
  cors({
    origin: [
      "https://waterdropping.com",
      "https://dev.waterdropping.com",
      "https://stg.waterdropping.com",
    ],
    credentials: true,
  }),
);

app.get("/api/test", (_, res) => {
  res.send({
    success: true,
    data: "OK",
  });
});

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use(morgan("dev"));
app.use("/api/admin", AdminRouter);
app.use("/api/auth", AuthRouter);
app.use("/api/treasureBox", TreasureBoxRouter);
app.use("/api/advertisement", AdvertisementRouter);
app.use("/api/product", ProductRouter);
app.use("/api/cart", CartRouter);
app.use("/api/chatroom", ChatroomRouter);
app.use("/api/ecpay", EcPayRouter);
app.use("/api/order", OrderRouter);
app.use("/api/delivery", DeliveryRouter);
app.use("/api/collection", CollectionRouter);
app.use("/api/notification", NotificationRouter);
app.use("/api/file", FileRouter);

app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
