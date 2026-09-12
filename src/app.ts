import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
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
import RefundRouter from "./routers/refund";
import SystemRouter from "./routers/system";
import TreasureBoxRouter from "./routers/treasureBox";

const app = express();

app.use(express.json({ limit: "50mb" }));
app.use(cookieParser());
app.use(express.urlencoded({ limit: "50mb", extended: true }));
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
  res.send({ success: true, data: "OK" });
});

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use(morgan(process.env.NODE_ENV === "test" ? "tiny" : "dev"));
app.use("/api/admin", AdminRouter);
app.use("/api/auth", AuthRouter);
app.use("/api/treasureBox", TreasureBoxRouter);
app.use("/api/advertisement", AdvertisementRouter);
app.use("/api/product", ProductRouter);
app.use("/api/system", SystemRouter);
app.use("/api/cart", CartRouter);
app.use("/api/chatroom", ChatroomRouter);
app.use("/api/ecpay", EcPayRouter);
app.use("/api/order", OrderRouter);
app.use("/api/delivery", DeliveryRouter);
app.use("/api/refund", RefundRouter);
app.use("/api/collection", CollectionRouter);
app.use("/api/notification", NotificationRouter);
app.use("/api/file", FileRouter);

app.use(errorHandler);

export default app;
