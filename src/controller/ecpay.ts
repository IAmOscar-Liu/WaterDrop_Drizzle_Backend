import { Request, Response } from "express";
import { handleServiceError } from "../lib/error";
import { preparePayment } from "../repository/payment";
import { handlePaymentCallback } from "../services/payment";
import path from "path";
import {
  ECPAY_CHECKOUT_URL,
  ECPAY_LOGISTIC_BASE_URL,
  ECPAY_QUERY_LOGISTICS_TRADE_INFO_URL,
} from "../constants/ecpay";
import { sendJsonResponse } from "../lib/general";
import {
  getLogisticsStatus,
  getLogisticsStatusText,
  LogisticsType,
} from "../lib/logisticsStatus";
import { validateToken } from "../lib/token";
import {
  createDelivery,
  getDeliveryByMerchantTradeNo,
} from "../repository/delivery";
import {
  getMerchantTradeByMerchantTradeNo,
} from "../repository/order";
import deliveryService from "../services/delivery";
import ecpayService from "../services/ecpay";

const TEST_ORDER_ID = "test_order_12345";

class EcPayController {
  async createTestPayment(req: Request, res: Response): Promise<any> {
    if (process.env.NODE_ENV === "stg" || process.env.NODE_ENV === "production" || req.query.realAccount === "true") {
      return sendJsonResponse(res, { success: false, statusCode: 403, code: "FORBIDDEN", message: "This action is not available" });
    }
    const realAccount = false;

    const base_param = {
      MerchantID: ecpayService.getTestMerchantID(realAccount),
      MerchantTradeNo: ecpayService.generateTradeNo(),
      MerchantTradeDate: ecpayService.generateMerchantTradeDate(),
      PaymentType: "aio",
      TotalAmount: "10",
      TradeDesc: "測試商品描述",
      ItemName: "測試商品",
      ReturnURL: `${process.env.HOST}/api/ecpay/return`,
      ClientBackURL: `${process.env.HOST}/api/ecpay/clientReturn`,
      ChoosePayment: "Credit",
      // Explicitly block every non-credit tab/wallet so only Credit shows
      // Reference: ECPay AIO V5 supports excluding by '#'-joined tokens
      IgnorePayment:
        "ATM#WebATM#CVS#BARCODE#ApplePay#GooglePay#AndroidPay#BNPL#TWQR#WeiXin#LINEPay#JKOPay#ESUNWallet#PiWallet#ECPayWallet#iPASS",
      EncryptType: 1,
      CustomField1: TEST_ORDER_ID,
    };

    const formHtml = ecpayService.generateFormHtml({
      actionUrl: ecpayService.getTestCheckoutUrl(realAccount),
      parameters: base_param,
      checkMacValueOptions: {
        hashKey: ecpayService.getTestHashKey(realAccount),
        hashIV: ecpayService.getTestHashIV(realAccount),
      },
    });

    return res.send(formHtml);
  }

  async createPayment(req: Request, res: Response): Promise<any> {
    const {
      token,
      orderId,
      idempotencyKey,
      totalAmount,
      tradeDesc,
      itemName,
      ChoosePayment = "Credit",
    } = req.query;

    if (
      !token ||
      !orderId ||
      !idempotencyKey ||
      !totalAmount ||
      !tradeDesc ||
      !itemName
    )
      return sendJsonResponse(res, { success: false, statusCode: 400, code: "VALIDATION_FAILED", message: "Missing required parameters" });
    const payload = validateToken(String(token));
    if (!payload || typeof payload === "string" || !payload.data?.id)
      return sendJsonResponse(res, { success: false, statusCode: 401, code: "UNAUTHENTICATED", message: "Please sign in again" });
    if (![process.env.MERCHANTID, process.env.HASHKEY, process.env.HASHIV, process.env.HOST].every(Boolean)) {
      return sendJsonResponse(res, { success: false, statusCode: 503, code: "SERVICE_UNAVAILABLE", message: "Service temporarily unavailable" });
    }
    let attempt;
    try {
      attempt = await preparePayment({ orderId: String(orderId), userId: payload.data.id,
        idempotencyKey: String(idempotencyKey), amount: Number(totalAmount), method: String(ChoosePayment) });
    } catch (error) {
      const result = handleServiceError(error);
      return sendJsonResponse(res, result);
    }

    const base_param =
      ChoosePayment === "Credit"
        ? {
            MerchantID: process.env.MERCHANTID,
            MerchantTradeNo: attempt.merchantTradeNo,
            MerchantTradeDate: ecpayService.generateMerchantTradeDate(),
            PaymentType: "aio",
            ChoosePayment: "Credit",
            // Explicitly block every non-credit tab/wallet so only Credit shows
            // Reference: ECPay AIO V5 supports excluding by '#'-joined tokens
            IgnorePayment:
              "ATM#WebATM#CVS#BARCODE#ApplePay#GooglePay#AndroidPay#BNPL#TWQR#WeiXin#LINEPay#JKOPay#ESUNWallet#PiWallet#ECPayWallet#iPASS",
            // IgnorePayment: "CVS#BARCODE#TWQR#BNPL#WeiXin",
            TotalAmount: attempt.amount,
            TradeDesc: String(tradeDesc),
            ItemName: String(itemName),
            ReturnURL: `${process.env.HOST}/api/ecpay/return`,
            ClientBackURL: `${process.env.HOST}/api/ecpay/clientReturn`,
            EncryptType: 1,
            CustomField1: String(orderId),
            CustomField2: String(idempotencyKey),
          }
        : {
            MerchantID: process.env.MERCHANTID,
            MerchantTradeNo: attempt.merchantTradeNo,
            MerchantTradeDate: ecpayService.generateMerchantTradeDate(),
            PaymentType: "aio",
            ChoosePayment: "ATM",
            // Explicitly block every non-credit tab/wallet so only Credit shows
            // Reference: ECPay AIO V5 supports excluding by '#'-joined tokens
            // IgnorePayment:
            //   "Credit#WebATM#CVS#BARCODE#ApplePay#GooglePay#AndroidPay#BNPL#TWQR#WeiXin#LINEPay#JKOPay#ESUNWallet#PiWallet#ECPayWallet#iPASS",
            // IgnorePayment: "CVS#BARCODE#TWQR#BNPL#WeiXin",
            TotalAmount: attempt.amount,
            TradeDesc: String(tradeDesc),
            ItemName: String(itemName),
            ReturnURL: `${process.env.HOST}/api/ecpay/return`,
            ClientBackURL: `${process.env.HOST}/api/ecpay/clientReturn`,
            EncryptType: 1,
            CustomField1: String(orderId),
            CustomField2: String(idempotencyKey),
            PaymentInfoURL: `${process.env.HOST}/api/ecpay/paymentInfo`,
            ExpireDate: 1,
          };



    const formHtml = ecpayService.generateFormHtml({
      actionUrl: ECPAY_CHECKOUT_URL,
      parameters: base_param,
      checkMacValueOptions: {
        hashKey: process.env.HASHKEY!,
        hashIV: process.env.HASHIV!,
      },
    });

    return res.send(formHtml);
  }

  async handleReturn(req: Request, res: Response): Promise<any> {
    // Only the dedicated sandbox test checkout has no application order.
    if (!["stg", "production"].includes(process.env.NODE_ENV ?? "") && req.body.CustomField1 === TEST_ORDER_ID
      && req.body.MerchantID === ecpayService.getTestMerchantID(false)
      && ecpayService.validateCheckMacValue(req.body, { hashKey: ecpayService.getTestHashKey(false), hashIV: ecpayService.getTestHashIV(false) })) {
      return res.send("1|OK");
    }
    try {
      await handlePaymentCallback(req.body);
      return res.send("1|OK");
    } catch (error) {
      const result = handleServiceError(error);
      return res.status(result.statusCode ?? 500).send("0|Payment confirmation could not be saved");
    }
  }

  async handlePaymentInfo(req: Request, res: Response): Promise<any> {
    try {
      await handlePaymentCallback(req.body, true);
      return res.send("1|OK");
    } catch (error) {
      const result = handleServiceError(error);
      return res.status(result.statusCode ?? 500).send("0|Payment information could not be saved");
    }
  }

  async handleClientReturn(req: Request, res: Response): Promise<any> {
    res.sendFile(
      path.resolve(process.cwd(), "src/assets/html/clientReturn.html"),
    );
  }

  async getLogisticsMap(req: Request, res: Response): Promise<any> {
    const mapParams = {
      MerchantID: process.env.LOGISTICS_MERCHANTID,
      LogisticsType: "CVS",
      LogisticsSubType: req.query.logisticsSubType ?? "FAMI", //. "FAMI", // 範例：7-ELEVEN
      IsCollection: "N", // 是否代收貨款
      ServerReplyURL: `${process.env.HOST}/api/ecpay/logistics/map-callback`, // 接收門市資訊的後端網址
      Device: 1,
    };

    const formHtml = ecpayService.generateFormHtml({
      actionUrl: `${ECPAY_LOGISTIC_BASE_URL}/Express/map`,
      parameters: mapParams,
    });

    return res.send(formHtml);
  }

  async handleLogisticsMapCallback(req: Request, res: Response): Promise<any> {
    const data = req.body;

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
        <body>
          <h1>Success</h1>

          <script>
            window.addEventListener(
              "flutterInAppWebViewPlatformReady",
              function (event) {
                window.flutter_inappwebview.callHandler("logistics-map-callback", ${JSON.stringify(
                  data,
                  null,
                  2,
                )});
              }
            );
          </script>
        </body>
      </html>
      `);
  }

  async validateLogisticsParams(req: Request, res: Response): Promise<any> {
    const result = ecpayService.validateLogisticsParams(req.body);
    if (!result) {
      sendJsonResponse(res, { success: true, data: "OK" });
    } else {
      sendJsonResponse(res, { success: false, statusCode: 400, code: "VALIDATION_FAILED", message: result });
    }
  }

  async validateSavedStores(req: Request, res: Response) {
    const result = ecpayService.validateSavedStores(req.body);
    sendJsonResponse(res, { success: true, data: result });
  }

  async createTestExpress(req: Request, res: Response): Promise<any> {
    const {
      type = "B2C",
      LogisticsSubType,
      SenderName,
      SenderCellPhone,
      ReceiverStoreID,
      ReceiverName,
      ReceiverCellPhone,
      ReceiverEmail,
    } = req.query;

    if (!ReceiverName || !ReceiverCellPhone || !ReceiverEmail)
      return sendJsonResponse(res, { success: false, statusCode: 400, message: "Missing required parameters" });

    const realAccount = req.query.realAccount === "true";
    if (realAccount) {
      if (!LogisticsSubType)
        return sendJsonResponse(res, { success: false, statusCode: 400, message: "LogisticsSubType is required" });
      if (!ReceiverStoreID)
        return sendJsonResponse(res, { success: false, statusCode: 400, message: "ReceiverStoreID is required" });
      if (type !== "B2C" && !SenderCellPhone) {
        return sendJsonResponse(res, { success: false, statusCode: 400, message: "SenderCellPhone is required for real account when type is C2C" });
      }
    }

    const isB2C = type === "B2C";

    const base_param = {
      MerchantID: ecpayService.getTestLogisticMerchantID(realAccount, isB2C),
      MerchantTradeNo: ecpayService.generateTradeNo(),
      MerchantTradeDate: ecpayService.generateMerchantTradeDate(),
      LogisticsType: "CVS",
      LogisticsSubType: realAccount
        ? LogisticsSubType
        : isB2C
          ? "UNIMART"
          : "UNIMARTC2C", // 範例：7-ELEVEN
      GoodsName: "測試商品",
      GoodsAmount: "300",
      SenderName: SenderName || "水滴賣家",
      IsCollection: "N", // 是否代收貨款
      ServerReplyURL: `${process.env.HOST}/api/ecpay/express/test/server-reply`, // 接收門市資訊的後端網址
      ClientReplyURL: `${process.env.HOST}/api/ecpay/express/test/client-reply`,
      ReceiverName: String(ReceiverName), // "王小明",
      ReceiverCellPhone: String(ReceiverCellPhone), // "0978443522",
      ReceiverEmail: String(ReceiverEmail), // "safaf2@ddd.com",
      ReceiverStoreID: realAccount ? ReceiverStoreID : "131386",
      ...(isB2C
        ? {}
        : {
            SenderCellPhone: realAccount
              ? SenderCellPhone
              : process.env.LOGISTICS_SENDER_CELL_PHONE,
          }),
      CustomField1: "CustomField1",
    };

    const formHtml = ecpayService.generateFormHtml({
      actionUrl: ecpayService.getTestExpressUrl(realAccount),
      parameters: base_param,
      checkMacValueOptions: {
        hashKey: ecpayService.getTestLogisticHashKey(realAccount, isB2C),
        hashIV: ecpayService.getTestLogisticHashIV(realAccount, isB2C),
        algorithm: "md5",
      },
    });

    return res.send(formHtml);
  }

  async handleTestExpressServerReply(
    req: Request,
    res: Response,
  ): Promise<any> {
    const data = req.body;
    res.send("1|OK");
  }

  async handleTestExpressClientReply(
    req: Request,
    res: Response,
  ): Promise<any> {
    res.send(`
     <!DOCTYPE html>
      <html lang="en">
        <body>
          <h1>Success</h1>

          <script>
            window.addEventListener(
              "flutterInAppWebViewPlatformReady",
              function (event) {
                window.flutter_inappwebview.callHandler("express-test-reply", ${JSON.stringify(
                  req.body,
                  null,
                  2,
                )});
              }
            );
          </script>
        </body>
      </html>
    `);
  }

  /** deprecated, no longer called from api */
  // async createExpress(req: Request, res: Response): Promise<any> {
  //   const {
  //     token,
  //     type = "B2C",
  //     orderId,
  //     productIds,
  //     LogisticsSubType,
  //     GoodsName,
  //     GoodsAmount,
  //     ReceiverName,
  //     ReceiverCellPhone,
  //     ReceiverEmail,
  //     ReceiverStoreID,
  //     ReceiverStoreName,
  //     ReceiverStoreAddress,
  //     ReceiverStoreTelephone,
  //     SenderName,
  //     SenderCellPhone,
  //     shippingCost,
  //     shippingCostDeduction,
  //   } = req.query;

  //   if (
  //     !token ||
  //     !orderId ||
  //     !LogisticsSubType ||
  //     !GoodsName ||
  //     !GoodsAmount ||
  //     !ReceiverName ||
  //     !ReceiverCellPhone ||
  //     !ReceiverEmail ||
  //     !ReceiverStoreID
  //   )
  //     return sendJsonResponse(res, { success: false, statusCode: 400, message: "Missing required parameters" });
  //   if (type !== "B2C" && !SenderCellPhone) {
  //     return res.send("SenderCellPhone is required when type is C2C");
  //   }

  //   const payload = validateToken(String(token));
  //   if (!payload || typeof payload === "string" || !payload.data?.id)
  //     return sendJsonResponse(res, { success: false, statusCode: 401, message: "Please sign in again" });

  //   const merchantTradeNo = ecpayService.generateTradeNo();

  //   let pIds: string[] = [];
  //   if (Array.isArray(productIds)) {
  //     pIds = productIds.filter((p) => typeof p === "string") as string[];
  //   } else if (typeof productIds === "string") {
  //     pIds = [productIds];
  //   }

  //   if (pIds.length > 0) {
  //     const cvsStoreInfo: Record<string, string> = {};
  //     cvsStoreInfo["storeID"] = String(ReceiverStoreID);
  //     if (ReceiverStoreName)
  //       cvsStoreInfo["storeName"] = String(ReceiverStoreName);
  //     if (ReceiverStoreAddress)
  //       cvsStoreInfo["storeAddress"] = String(ReceiverStoreAddress);
  //     if (ReceiverStoreTelephone)
  //       cvsStoreInfo["storeTelephone"] = String(ReceiverStoreTelephone);

  //     await createMerchantTrade({
  //       merchantTradeNo,
  //       orderId: String(orderId),
  //       productIds: pIds,
  //       variantIds: [],
  //       cvsStoreInfo,
  //       shippingCost: shippingCost ? Number(shippingCost) : 0,
  //       shippingCostDeduction: shippingCostDeduction
  //         ? Number(shippingCostDeduction)
  //         : 0,
  //     });
  //   }

  //   const maxGoodsAmount = Math.min(20000, Math.floor(Number(GoodsAmount)));

  //   const base_param = {
  //     MerchantID: process.env.LOGISTICS_MERCHANTID,
  //     MerchantTradeNo: merchantTradeNo,
  //     MerchantTradeDate: ecpayService.generateMerchantTradeDate(),
  //     LogisticsType: "CVS",
  //     LogisticsSubType, // 範例：7-ELEVEN
  //     GoodsName: String(GoodsName),
  //     GoodsAmount: String(maxGoodsAmount),
  //     CollectionAmount: String(maxGoodsAmount),
  //     SenderName: SenderName || "水滴賣家",
  //     IsCollection: "N", // 是否代收貨款
  //     ServerReplyURL: `${process.env.HOST}/api/ecpay/express/server-reply`, // 接收門市資訊的後端網址
  //     ClientReplyURL: `${process.env.HOST}/api/ecpay/express/client-reply`, // 接收門市資訊的後端網址
  //     ReceiverName: String(ReceiverName),
  //     ReceiverCellPhone: String(ReceiverCellPhone),
  //     ReceiverEmail: String(ReceiverEmail),
  //     ReceiverStoreID: String(ReceiverStoreID),
  //     ...(type === "B2C" ? {} : { SenderCellPhone: String(SenderCellPhone) }),
  //   };

  //   console.log("base_param: ", base_param);

  //   const formHtml = ecpayService.generateFormHtml({
  //     actionUrl: `${ECPAY_LOGISTIC_BASE_URL}/Express/Create`,
  //     parameters: base_param,
  //     checkMacValueOptions: {
  //       hashKey: process.env.LOGISTICS_HASH_KEY!,
  //       hashIV: process.env.LOGISTICS_HASH_IV!,
  //       algorithm: "md5",
  //     },
  //   });

  //   return res.send(formHtml);
  // }

  async handleExpressClientReply(req: Request, res: Response): Promise<any> {
    res.send(`
     <!DOCTYPE html>
      <html lang="en">
        <body>
          <h1>Success</h1>

          <script>
            window.addEventListener(
              "flutterInAppWebViewPlatformReady",
              function (event) {
                window.flutter_inappwebview.callHandler("express-reply", ${JSON.stringify(
                  req.body,
                  null,
                  2,
                )});
              }
            );
          </script>
        </body>
      </html>
    `);
  }

  async handleExpressServerReply(req: Request, res: Response): Promise<any> {
    const data = req.body;

    if (
      !ecpayService.validateCheckMacValue(data, {
        hashKey: process.env.LOGISTICS_HASH_KEY!,
        hashIV: process.env.LOGISTICS_HASH_IV!,
        algorithm: "md5",
      })
    ) {
      return res.status(400).send("Invalid CheckMacValue");
    }

    try {
      const merchantTrade = await getMerchantTradeByMerchantTradeNo(
        data.MerchantTradeNo,
      );
      if (!merchantTrade) throw new Error("Order not found");

      const existingDelivery = await getDeliveryByMerchantTradeNo(
        merchantTrade.merchantTradeNo,
      );

      if (existingDelivery) {
        const type = data.LogisticsSubType.replace("CVS_", "") as LogisticsType;
        const RtnCode = String(data.RtnCode);
        // const RtnMsg = String(data.RtnMsg);
        const RtnMsg = getLogisticsStatusText(type, RtnCode);
        const status = getLogisticsStatus(type, RtnCode);

        const result = await deliveryService.updateDelivery(existingDelivery.id, {
          status,
          RtnCode,
          RtnMsg,
        }, undefined, "provider_callback");
        if (!result.success) throw new Error("Could not persist logistics callback");
      } else {
        if (
          merchantTrade.productIds.length !== merchantTrade.variantIds.length ||
          merchantTrade.variantIds.some((variantId) => !variantId)
        ) {
          throw new Error(
            "Merchant trade productIds and variantIds must be paired",
          );
        }

        await createDelivery(
          {
            status: getLogisticsStatus(data.LogisticsSubType.replace("CVS_", ""), String(data.RtnCode)),
            orderId: merchantTrade.orderId,
            merchantTradeNo: merchantTrade.merchantTradeNo,
            AllPayLogisticsID: data.AllPayLogisticsID,
            LogisticsType: data.LogisticsType ?? "CVS",
            LogisticsSubType: data.LogisticsSubType,
            CVSPaymentNo: data.CVSPaymentNo ?? null,
            CVSValidationNo: data.CVSValidationNo ?? null,
            GoodsAmount: Number(data.GoodsAmount),
            RtnCode: data.RtnCode,
            RtnMsg: data.RtnMsg,
            cvsStoreInfo: merchantTrade.cvsStoreInfo,
            metadata: data,
            fee: merchantTrade.shippingCost,
            feeDeduction: merchantTrade.shippingCostDeduction,
          },
          merchantTrade?.productIds.map((productId, i) => ({
            productId,
            variantId: merchantTrade?.variantIds[i] || "",
          })),
          "provider_callback",
        );
      }
    } catch (error) {
      handleServiceError(error);
      return res.status(500).send("0|Persistence failed");
    }

    res.send(`1|OK`);
  }

  async printTradeDocument(req: Request, res: Response) {
    const {
      token,
      LogisticsSubType,
      AllPayLogisticsID,
      CVSPaymentNo,
      CVSValidationNo,
    } = req.query;

    if (!token || !LogisticsSubType || !AllPayLogisticsID)
      return sendJsonResponse(res, { success: false, statusCode: 400, message: "Missing required parameters" });
    if (
      typeof LogisticsSubType === "string" &&
      LogisticsSubType.endsWith("C2C")
    ) {
      if (
        LogisticsSubType === "UNIMARTC2C" &&
        (!CVSPaymentNo || !CVSValidationNo)
      )
        return sendJsonResponse(res, { success: false, statusCode: 400, message: "CVSPaymentNo and CVSValidationNo are required if LogisticsSubType is UNIMARTC2C" });
      if (LogisticsSubType === "FAMIC2C" && !CVSPaymentNo)
        return sendJsonResponse(res, { success: false, statusCode: 400, message: "CVSPaymentNo is required if LogisticsSubType is FAMIC2C" });
      if (LogisticsSubType === "OKMARTC2C" && !CVSPaymentNo)
        return sendJsonResponse(res, { success: false, statusCode: 400, message: "CVSPaymentNo is required if LogisticsSubType is OKMARTC2C" });
    }
    const payload = validateToken(String(token));
    if (!payload || typeof payload === "string" || !payload.data?.id)
      return sendJsonResponse(res, { success: false, statusCode: 401, message: "Please sign in again" });

    const formHtml = ecpayService.generateFormHtml({
      actionUrl: ecpayService.getPrintTradeDocumentActionUrl(LogisticsSubType),
      parameters: ecpayService.getPrintTradeDocumentParameters(
        process.env.LOGISTICS_MERCHANTID!,
        { LogisticsSubType, AllPayLogisticsID, CVSPaymentNo, CVSValidationNo },
      ),
      checkMacValueOptions: {
        hashKey: process.env.LOGISTICS_HASH_KEY!,
        hashIV: process.env.LOGISTICS_HASH_IV!,
        algorithm: "md5",
      },
    });

    return res.send(formHtml);
  }

  async queryLogisticsTradeInfo(req: Request, res: Response): Promise<any> {
    const { token, AllPayLogisticsID, MerchantTradeNo } = req.query;
    if (!token) return sendJsonResponse(res, { success: false, statusCode: 400, message: "Missing required parameters" });
    if (!AllPayLogisticsID && !MerchantTradeNo)
      return sendJsonResponse(res, { success: false, statusCode: 400, message: "AllPayLogisticsID or MerchantTradeNo is required" });

    const payload = validateToken(String(token));
    if (!payload || typeof payload === "string" || !payload.data?.id)
      return sendJsonResponse(res, { success: false, statusCode: 401, message: "Please sign in again" });

    const parameters: Record<string, any> = {
      MerchantID: process.env.LOGISTICS_MERCHANTID,
      TimeStamp: Math.floor(Date.now() / 1000),
    };

    if (AllPayLogisticsID) {
      parameters["AllPayLogisticsID"] = String(AllPayLogisticsID);
    }
    if (MerchantTradeNo) {
      parameters["MerchantTradeNo"] = String(MerchantTradeNo);
    }

    const formHtml = ecpayService.generateFormHtml({
      actionUrl: ECPAY_QUERY_LOGISTICS_TRADE_INFO_URL,
      parameters,
      checkMacValueOptions: {
        hashKey: process.env.LOGISTICS_HASH_KEY!,
        hashIV: process.env.LOGISTICS_HASH_IV!,
        algorithm: "md5",
      },
    });

    return res.send(formHtml);
  }

  async queryLogisticsTradeInfoJSON(req: Request, res: Response): Promise<any> {
    const { AllPayLogisticsID, MerchantTradeNo } = req.query;

    if (!AllPayLogisticsID && !MerchantTradeNo)
      return res.status(400).json({
        success: false,
        error: "AllPayLogisticsID or MerchantTradeNo is required",
      });

    try {
      const resultData = await ecpayService.queryLogisticsTradeInfo(
        {
          AllPayLogisticsID: AllPayLogisticsID
            ? String(AllPayLogisticsID)
            : undefined,
          MerchantTradeNo: MerchantTradeNo
            ? String(MerchantTradeNo)
            : undefined,
        },
        { throwError: true },
      );

      return res.json({
        success: true,
        data: resultData,
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: "查詢失敗" });
    }
  }

  async getStoreList(req: Request, res: Response): Promise<any> {
    const { CvsType } = req.query;

    try {
      const resultData = await ecpayService.getStoreList(
        { CvsType: CvsType ? (String(CvsType) as any) : "All" },
        { throwError: true },
      );

      return res.json({
        success: true,
        data: resultData,
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: "查詢失敗" });
    }
  }
}

export default new EcPayController();
