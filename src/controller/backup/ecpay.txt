import { Request, Response } from "express";
import { validateToken } from "../lib/token";
import path from "path";
import { updateOrderStatus } from "../repository/order";
import ecpayService from "../services/ecpay";

const TEST_ORDER_ID = "test_order_12345";

class EcPayController {
  async createTestPayment(req: Request, res: Response): Promise<any> {
    const html = ecpayService.generatePaymentHtml({
      orderId: TEST_ORDER_ID,
      data: {
        totalAmount: 100,
        tradeDesc: "測試交易",
        itemName: "測試商品",
      },
    });
    return res.send(html);
  }

  async createPayment(req: Request, res: Response): Promise<any> {
    const { token, orderId, totalAmount, tradeDesc, itemName } = req.query;

    if (!token || !orderId || !totalAmount || !tradeDesc || !itemName)
      return res.send("Missing required parameters");
    if (!validateToken(String(token))) return res.send("Invalid token");

    const html = ecpayService.generatePaymentHtml({
      orderId: String(orderId),
      data: {
        totalAmount: Number(totalAmount),
        tradeDesc: String(tradeDesc),
        itemName: String(itemName),
      },
    });
    return res.send(html);
  }

  async handleReturn(req: Request, res: Response): Promise<any> {
    const data = req.body;
    const { CheckMacValue, checkValue, orderId } =
      ecpayService.getCheckValue(data);

    console.log(
      "確認交易正確性：",
      CheckMacValue === checkValue,
      CheckMacValue,
      checkValue
    );

    if (orderId !== TEST_ORDER_ID)
      await updateOrderStatus(
        orderId,
        data.RtnCode == 1 ? "paid" : "failed",
        data
      )
        .then((result) => {
          if (!result) throw new Error("Order not found");
          console.log(`Successfully updated order:`, result.id);
        })
        .catch((error) => console.error("Error updating order:", error));

    // 交易成功後，需要回傳 1|OK 給綠界
    res.send("1|OK");
  }

  async handleClientReturn(req: Request, res: Response): Promise<any> {
    console.log("clientReturn:", req.body, req.query);
    res.sendFile(
      path.resolve(process.cwd(), "src/assets/html/clientReturn.html")
    );
  }
}

export default new EcPayController();
