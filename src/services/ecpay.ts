import crypto from "crypto";
import fs from "fs";
import path from "path";
import querystring from "querystring";
import {
  ECPAY_CHECKOUT_URL,
  ECPAY_GET_STORE_LIST_URL,
  ECPAY_LOGISTIC_BASE_URL,
  ECPAY_QUERY_LOGISTICS_TRADE_INFO_URL,
} from "../constants/ecpay";
import {
  getEcpayLength as getEcpayStringLength,
  hasEmoji as containsEmoji,
  hasSpecialChars as containsSpecialChars,
} from "../lib/ecpayValidation";
import { generateRandomString } from "../lib/general";
import axios from "axios";
import {
  getLogisticsStatus,
  getLogisticsStatusText,
  LogisticsType,
} from "../lib/logisticsStatus";
import { createMerchantTrade } from "../repository/order";

class EcPayService {
  getTestMerchantID(realAccount: boolean): string {
    return !realAccount ? "3002607" : process.env.MERCHANTID!;
  }

  getTestHashKey(realAccount: boolean): string {
    return !realAccount ? "pwFHCqoQZGmho4w6" : process.env.HASHKEY!;
  }

  getTestHashIV(realAccount: boolean): string {
    return !realAccount ? "EkRm7iFT261dpevs" : process.env.HASHIV!;
  }

  getTestLogisticMerchantID(realAccount: boolean, isB2C: boolean): string {
    if (realAccount) return process.env.LOGISTICS_MERCHANTID!;
    return isB2C ? "2000132" : "2000933";
  }

  getTestLogisticHashKey(realAccount: boolean, isB2C: boolean): string {
    if (realAccount) return process.env.LOGISTICS_HASH_KEY!;
    return isB2C ? "5294y06JbISpM5x9" : "XBERn1YOvpM9nfZc";
  }

  getTestLogisticHashIV(realAccount: boolean, isB2C: boolean): string {
    if (realAccount) return process.env.LOGISTICS_HASH_IV!;
    return isB2C ? "v77hoKGq4kWxNNIS" : "h1ONHk4P4yqbl5LK";
  }

  getTestCheckoutUrl(realAccount: boolean): string {
    return !realAccount
      ? "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5"
      : ECPAY_CHECKOUT_URL!;
  }

  getTestExpressUrl(realAccount: boolean): string {
    return !realAccount
      ? "https://logistics-stage.ecpay.com.tw/Express/Create"
      : `${ECPAY_LOGISTIC_BASE_URL}/Express/Create`;
  }

  generateTradeNo(length?: number) {
    // return "test" + new Date().getTime();
    return generateRandomString(length ?? 20);
  }

  generateMerchantTradeDate() {
    // return new Date().toLocaleString("zh-TW", {
    //   year: "numeric",
    //   month: "2-digit",
    //   day: "2-digit",
    //   hour: "2-digit",
    //   minute: "2-digit",
    //   second: "2-digit",
    //   hour12: false,
    //   timeZone: "UTC",
    // });
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");

    // 確保中間只有一個標準的半形空格
    return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
  }

  generateFormHtml({
    actionUrl,
    parameters,
    checkMacValueOptions,
  }: {
    actionUrl: string;
    parameters: Record<string, any>;
    checkMacValueOptions?: {
      algorithm?: string;
      hashKey: string;
      hashIV: string;
    };
  }) {
    let formHtml = `<form id="ecpayForm" action="${actionUrl}" method="POST" style="display: none;">`;

    // 插入所有參數作為隱藏欄位
    for (const key in parameters) {
      if (Object.hasOwnProperty.call(parameters, key)) {
        // 確保值被轉換為字串，以正確插入 HTML value 屬性
        formHtml += `<input name="${key}" value="${String(
          parameters[key],
        )}"/>\n`;
      }
    }

    // 插入 CheckMacValue
    if (checkMacValueOptions) {
      // 計算 CheckMacValue
      const checkMacValue = this.generateCheckValue(
        parameters,
        checkMacValueOptions.hashKey,
        checkMacValueOptions.hashIV,
        checkMacValueOptions.algorithm ?? "sha256",
      );

      formHtml += `<input name="CheckMacValue" value="${checkMacValue}" />\n`;
    }
    formHtml += `</form>`;

    // 插入自動提交的腳本
    formHtml += `<script>document.getElementById('ecpayForm').submit();</script>`;

    return formHtml;
  }

  generateCheckValue(
    params: Record<string, any>,
    HashKey: string,
    HashIV: string,
    algorithm: string = "sha256",
  ) {
    //將 params 從 Object 換成 Array
    const entries = Object.entries(params);

    //第一步，將 params 按照 key 值得字母順序排列
    entries.sort((a, b) => {
      return a[0].localeCompare(b[0]);
    });

    //第二步，用 key1=value1&key2=value2... 這樣的 pattern 將所有 params 串聯成字串
    //並前後加上 HashKey & HashIV 的 value
    let result =
      `HashKey=${HashKey}&` +
      entries.map((x) => `${x[0]}=${x[1]}`).join("&") +
      `&HashIV=${HashIV}`;

    //第三步，encode URL 並轉換成小寫
    result = encodeURIComponent(result).toLowerCase();

    //第四步，因爲綠姐姐的 URL encode 是 follow RFC 1866
    //使用 js 的encodeURIComponent() 還需要處理一下
    //follow guidence from ECPay https://www.ecpay.com.tw/CascadeFAQ/CascadeFAQ_Qa?nID=1197
    result = result
      .replace(/%2d/g, "-")
      .replace(/%5f/g, "_")
      .replace(/%2e/g, ".")
      .replace(/%21/g, "!")
      .replace(/%2a/g, "*")
      .replace(/%28/g, "(")
      .replace(/%29/g, ")")
      .replace(/%20/g, "+");

    //第五步，轉成 SHA256
    // result = crypto.SHA256(result).toString();
    const hash = crypto.createHash(algorithm);
    hash.update(result);
    const hexHash = hash.digest("hex");

    //最後，轉成大寫
    console.log(`check value: ${hexHash.toUpperCase()}`);
    return hexHash.toUpperCase();
  }

  /**
   * 檢查字串長度是否符合綠界規範。
   * 規則：中文佔2字元、全形佔2字元、其餘佔1字元。
   * @param {string} str - 要計算長度的字串。
   * @returns {number} 綠界規範下的長度。
   */
  getEcpayLength(str: string) {
    return getEcpayStringLength(str);
  }

  hasSpecialChars(str: string) {
    return containsSpecialChars(str);
  }

  hasEmoji(str: string) {
    return containsEmoji(str);
  }

  /**
   * 驗證物流訂單參數是否符合綠界 API 規範。
   * @param {Record<string, any>} params - 準備傳送的參數物件。
   * @returns {string | null} 錯誤訊息字串，如果通過則為 null。
   */
  validateLogisticsParams(params: Record<string, any>) {
    const {
      SenderNames,
      SenderCellPhones,
      ReceiverName,
      ReceiverCellPhone,
      ReceiverEmail,
      GoodsNames,
      GoodsAmount,
    } = params;

    // 1. 驗證 ReceiverName
    // 規定: 字元限制為4~10個字元(例：半形英文可支援4~10個字，中文可支援2~5個字)
    // 不可帶入不符合姓名規則的文字如表情圖示(emoji符號)
    if (ReceiverName) {
      const receiverNameStr = String(ReceiverName);
      const nameLength = this.getEcpayLength(receiverNameStr);

      if (nameLength < 4 || nameLength > 10) {
        return `收件人姓名長度須介於 4 到 10 個字元之間 (目前長度: ${nameLength})`;
      }

      // 檢查是否包含表情符號 (emoji)
      if (this.hasEmoji(receiverNameStr)) {
        return `收件人姓名不可包含表情符號`;
      }
    }

    // 1.2 驗證 SenderNames, 規定同上
    if (Array.isArray(SenderNames)) {
      console.log(`validating sender names: ${SenderNames}`);
      for (let SenderName of SenderNames) {
        if (!SenderName) return `寄件人姓名不存在`;

        const senderNameStr = String(SenderName);
        const nameLength = this.getEcpayLength(senderNameStr);

        if (nameLength < 4 || nameLength > 10) {
          return `寄件人姓名長度須介於 4 到 10 個字元之間 (目前長度: ${nameLength})`;
        }

        // 檢查是否包含表情符號 (emoji)
        if (this.hasEmoji(senderNameStr)) {
          return `寄件人姓名不可包含表情符號`;
        }
      }
    }

    // 2. 驗證 ReceiverCellPhone (手機): 規定長度為 10 碼數字
    const phoneRegex = /^09\d{8}$/;
    if (ReceiverCellPhone && !phoneRegex.test(String(ReceiverCellPhone))) {
      return `收件人手機格式錯誤，須為 09 開頭的 10 碼數字`;
    }

    // 2.1 驗證 SenderCellPhone, 規定同上
    if (Array.isArray(SenderCellPhones)) {
      console.log(`validating sender cell phones: ${SenderCellPhones}`);
      for (let SenderCellPhone of SenderCellPhones) {
        if (!SenderCellPhone) return `寄件人手機不存在`;

        if (!phoneRegex.test(String(SenderCellPhone))) {
          return `寄件人手機格式錯誤，須為 09 開頭的 10 碼數字`;
        }
      }
    }

    // 3. 驗證 ReceiverEmail (收件人信箱): 規定長度 <= 100
    if (ReceiverEmail) {
      const emailStr = String(ReceiverEmail);
      if (emailStr.length > 100 || !emailStr.includes("@")) {
        return `收件人信箱格式錯誤或長度超過 100 字元`;
      }
    }

    // 4. 驗證 GoodsName (商品名稱):
    // 規定不得輸入 ^ ‘ ` ! @ # % & * + \ ” < > | _ [ ] 等特殊符號，
    // 長度限制: 中文/全形佔2字元、其餘佔1字元，總長度 <= 50
    if (GoodsNames) {
      // const goodsNameStr = String(GoodsName);
      const goodsNameStrArr = Array.isArray(GoodsNames)
        ? GoodsNames.map((g) => String(g))
        : [String(GoodsNames)];

      for (let goodsNameStr of goodsNameStrArr) {
        // 優先檢核是否有特殊字元
        if (this.hasSpecialChars(goodsNameStr)) {
          return `商品名稱不得包含 ^ ‘ \` ! @ # % & * + \\ ” < > | _ [ ] 等特殊符號`;
        }

        // 再檢核是否有超過長度限制
        if (this.getEcpayLength(goodsNameStr) > 50) {
          return `商品名稱「${goodsNameStr}」總長度超過 50 字元 (目前長度: ${this.getEcpayLength(
            goodsNameStr,
          )})`;
        }
      }
    }

    // 5. 驗證 GoodsAmount (商品金額): 必須是數字，且必須介於 1 ~ 20000
    const goodsAmount = Number(GoodsAmount);
    if (
      isNaN(goodsAmount) ||
      goodsAmount < 1 ||
      goodsAmount > 20000 ||
      !Number.isInteger(goodsAmount)
    ) {
      return `商品金額必須是 1 到 20000 之間的正整數`;
    }

    // 您可以在這裡加入更多欄位的驗證...

    return null; // 通過所有驗證
  }

  validateSavedStores(stores: Record<string, any>) {
    try {
      const filePath = path.resolve(
        process.cwd(),
        "src/assets/json/ecpay-storeList.json",
      );
      if (!fs.existsSync(filePath)) return {};

      const storeList = JSON.parse(
        fs.readFileSync(filePath, "utf-8"),
      ) as Record<
        string,
        Array<{
          StoreId?: string;
          storeId?: string;
          StoreName?: string;
          StoreAddr?: string;
          StorePhone?: string;
        }>
      >;
      const cvsTypeMap: Record<string, string> = {
        FAMIC2C: "FAMI",
        UNIMARTC2C: "UNIMART",
        HILIFEC2C: "HILIFE",
        OKMARTC2C: "OKMART",
        OKMART_LOW_TMP_C2C: "OKMART",
      };
      const validatedStores: Record<string, any> = {};

      for (const [logisticsSubType, store] of Object.entries(stores)) {
        const cvsType = cvsTypeMap[logisticsSubType];
        const cvsStoreId = store?.CVSStoreID;
        if (!cvsType || !cvsStoreId) continue;

        const matchedStore = storeList[cvsType]?.find(
          (item) => String(item.StoreId ?? item.storeId) === String(cvsStoreId),
        );
        if (!matchedStore) continue;

        const incomingName =
          typeof store?.CVSStoreName === "string" ? store.CVSStoreName : "";
        const matchedName = String(matchedStore.StoreName ?? "");
        const a = incomingName.trim().toLowerCase();
        const b = matchedName.trim().toLowerCase();
        const sharePrefix =
          a.length > 0 && (a.startsWith(b) || b.startsWith(a));
        const chosenName = sharePrefix
          ? incomingName.length >= matchedName.length
            ? incomingName
            : matchedName
          : matchedName;

        validatedStores[logisticsSubType] = {
          ...store,
          CVSStoreID: matchedStore.StoreId ?? matchedStore.storeId,
          CVSStoreName: chosenName,
          CVSAddress: matchedStore.StoreAddr,
          CVSTelephone: matchedStore.StorePhone,
        };
      }

      return validatedStores;
    } catch (error) {
      return {};
    }
  }

  async createExpressServerReturn(
    {
      type = "B2C",
      orderId,
      products = [],
      LogisticsSubType,
      GoodsName,
      GoodsAmount,
      ReceiverName,
      ReceiverCellPhone,
      ReceiverEmail,
      ReceiverStoreID,
      ReceiverStoreName,
      ReceiverStoreAddress,
      ReceiverStoreTelephone,
      SenderName,
      SenderCellPhone,
      shippingCost,
      shippingCostDeduction,
    }: {
      products: Array<{ productId: string; variantId: string }>;
      [key: string]: any;
    },
    options?: { throwError?: boolean },
  ) {
    if (
      !orderId ||
      !LogisticsSubType ||
      !GoodsName ||
      !GoodsAmount ||
      !ReceiverName ||
      !ReceiverCellPhone ||
      !ReceiverEmail ||
      !ReceiverStoreID
    ) {
      console.error("Missing required parameters");
      if (options?.throwError) throw new Error("Missing required parameters");
      return null;
    }
    if (type !== "B2C" && !SenderCellPhone) {
      console.error("SenderCellPhone is required when type is C2C");
      if (options?.throwError)
        throw new Error("SenderCellPhone is required when type is C2C");
      return null;
    }

    const merchantTradeNo = this.generateTradeNo();

    // let pIds: string[] = [];
    const productIds = products.map((p) => p.productId);
    const variantIds = products.map((p) => p.variantId);

    if (
      productIds.length !== variantIds.length ||
      productIds.some((productId) => !productId) ||
      variantIds.some((variantId) => !variantId)
    ) {
      console.error("products must include paired productIds and variantIds");
      if (options?.throwError)
        throw new Error(
          "products must include paired productIds and variantIds",
        );
      return null;
    }

    if (products.length > 0) {
      const cvsStoreInfo: Record<string, string> = {};
      cvsStoreInfo["storeID"] = String(ReceiverStoreID);
      if (ReceiverStoreName)
        cvsStoreInfo["storeName"] = String(ReceiverStoreName);
      if (ReceiverStoreAddress)
        cvsStoreInfo["storeAddress"] = String(ReceiverStoreAddress);
      if (ReceiverStoreTelephone)
        cvsStoreInfo["storeTelephone"] = String(ReceiverStoreTelephone);

      await createMerchantTrade({
        merchantTradeNo,
        orderId: String(orderId),
        productIds,
        variantIds,
        cvsStoreInfo,
        shippingCost: shippingCost ? Number(shippingCost) : 0,
        shippingCostDeduction: shippingCostDeduction
          ? Number(shippingCostDeduction)
          : 0,
      });
    }

    const maxGoodsAmount = Math.min(20000, Math.floor(Number(GoodsAmount)));

    const base_param: Record<string, any> = {
      MerchantID: process.env.LOGISTICS_MERCHANTID,
      MerchantTradeNo: merchantTradeNo,
      MerchantTradeDate: this.generateMerchantTradeDate(),
      LogisticsType: "CVS",
      LogisticsSubType, // 範例：7-ELEVEN
      GoodsName: String(GoodsName),
      GoodsAmount: String(maxGoodsAmount),
      CollectionAmount: String(maxGoodsAmount),
      SenderName: SenderName || "水滴賣家",
      IsCollection: "N", // 是否代收貨款
      ServerReplyURL: `${process.env.HOST}/api/ecpay/express/server-reply`, // 接收門市資訊的後端網址
      ClientReplyURL: `${process.env.HOST}/api/ecpay/express/client-reply`, // 接收門市資訊的後端網址
      ReceiverName: String(ReceiverName),
      ReceiverCellPhone: String(ReceiverCellPhone),
      ReceiverEmail: String(ReceiverEmail),
      ReceiverStoreID: String(ReceiverStoreID),
      ...(type === "B2C" ? {} : { SenderCellPhone: String(SenderCellPhone) }),
    };

    base_param["CheckMacValue"] = this.generateCheckValue(
      base_param,
      process.env.LOGISTICS_HASH_KEY!,
      process.env.LOGISTICS_HASH_IV!,
      "md5",
    );

    console.log("base_param: ", base_param);

    try {
      // 使用 axios 發送 POST 到綠界 (注意：不是 res.send(formHtml))
      const response = await axios.post(
        `${ECPAY_LOGISTIC_BASE_URL}/Express/Create`,
        querystring.stringify(base_param), // 轉成 key=value&key2=value2 格式
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );

      // 解析綠界回傳的字串內容
      // 綠界會回傳像你提供的那串：ActualWeight=null&AllPayLogisticsID=...
      const resultData = querystring.parse(response.data);
      // console.log("Create ECPay Express Result:", resultData);

      // 回傳 JSON 給 Client
      return resultData;
    } catch (error) {
      console.error("Create ECPay Express Error:", error);
      if (options?.throwError) throw error;
      return null;
    }
  }

  getPrintTradeDocumentActionUrl(LogisticsSubType?: any) {
    if (LogisticsSubType === "UNIMARTC2C")
      return `${ECPAY_LOGISTIC_BASE_URL}/Express/PrintUniMartC2COrderInfo`;
    if (LogisticsSubType === `FAMIC2C`)
      return `${ECPAY_LOGISTIC_BASE_URL}/Express/PrintFAMIC2COrderInfo`;
    if (LogisticsSubType === "OKMARTC2C")
      return `${ECPAY_LOGISTIC_BASE_URL}/Express/PrintOKMARTC2COrderInfo`;
    return `${ECPAY_LOGISTIC_BASE_URL}/helper/printTradeDocument`;
  }

  getPrintTradeDocumentParameters(
    MerchantID: string,
    {
      LogisticsSubType,
      AllPayLogisticsID,
      CVSPaymentNo,
      CVSValidationNo,
    }: {
      LogisticsSubType: any;
      AllPayLogisticsID: any;
      CVSPaymentNo: any;
      CVSValidationNo: any;
    },
  ) {
    if (LogisticsSubType === "UNIMARTC2C")
      return {
        MerchantID,
        AllPayLogisticsID,
        CVSPaymentNo,
        CVSValidationNo,
      };
    if (LogisticsSubType === "FAMIC2C" || LogisticsSubType === "OKMARTC2C")
      return {
        MerchantID,
        AllPayLogisticsID,
        CVSPaymentNo,
      };
    return {
      MerchantID,
      AllPayLogisticsID,
      PrintMode: "1",
    };
  }

  async queryLogisticsTradeInfo(
    {
      AllPayLogisticsID,
      MerchantTradeNo,
    }: {
      AllPayLogisticsID?: string;
      MerchantTradeNo?: string;
    },
    options?: { throwError?: boolean },
  ) {
    const parameters: Record<string, any> = {
      MerchantID: process.env.LOGISTICS_MERCHANTID,
      TimeStamp: Math.floor(Date.now() / 1000),
    };

    if (AllPayLogisticsID && MerchantTradeNo) {
      // 如果同時提供 AllPayLogisticsID 和 MerchantTradeNo，則以 AllPayLogisticsID 為主(因爲綠界的 API 規定，如果提供 AllPayLogisticsID 就不需要提供 MerchantTradeNo)
      parameters["AllPayLogisticsID"] = String(AllPayLogisticsID);
    } else if (AllPayLogisticsID) {
      parameters["AllPayLogisticsID"] = String(AllPayLogisticsID);
    } else if (MerchantTradeNo) {
      parameters["MerchantTradeNo"] = String(MerchantTradeNo);
    }

    const checkMacValue = this.generateCheckValue(
      parameters,
      process.env.LOGISTICS_HASH_KEY!,
      process.env.LOGISTICS_HASH_IV!,
      "md5",
    );

    parameters["CheckMacValue"] = checkMacValue;

    try {
      // 使用 axios 發送 POST 到綠界 (注意：不是 res.send(formHtml))
      const response = await axios.post(
        ECPAY_QUERY_LOGISTICS_TRADE_INFO_URL,
        querystring.stringify(parameters), // 轉成 key=value&key2=value2 格式
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );

      // 解析綠界回傳的字串內容
      // 綠界會回傳像你提供的那串：ActualWeight=null&AllPayLogisticsID=...
      const resultData = querystring.parse(response.data);

      // const resultData: any = {
      //   ActualWeight: "null",
      //   AllPayLogisticsID: "47010410",
      //   BookingNote: "",
      //   CollectionAllocateAmount: "0",
      //   CollectionAllocateDate: "",
      //   CollectionAmount: "0",
      //   CollectionChargeFee: "0",
      //   CVSPaymentNo: "16333835341",
      //   CVSValidationNo: "",
      //   GoodsAmount: "300",
      //   GoodsName: "測試商品",
      //   GoodsWeight: "null",
      //   HandlingCharge: "69",
      //   LogisticsStatus: "3029",
      //   LogisticsType: "CVS_FAMIC2C",
      //   MerchantID: "3041403",
      //   MerchantTradeNo: "fe30b2d81c48ee9ca6e0",
      //   SenderCellPhone: "0926675158",
      //   SenderName: "吳竣瑋",
      //   SenderPhone: "null",
      //   ShipChargeDate: "",
      //   ShipmentNo: "47010410",
      //   TradeDate: "2026/03/11 14:21:48",
      //   CheckMacValue: "9CAE2E9B1E2AD5809D3D64CB0052B4E3",
      // };

      if (
        typeof resultData.LogisticsType === "string" &&
        resultData.LogisticsStatus
      ) {
        const type = resultData.LogisticsType.replace(
          "CVS_",
          "",
        ) as LogisticsType;
        const status = String(resultData.LogisticsStatus);
        (resultData as any).LogisticsStatusText = getLogisticsStatusText(
          type,
          status,
        );
        (resultData as any).DeliveryStatus = getLogisticsStatus(type, status);
      }

      // 回傳 JSON 給 Client
      return resultData;
    } catch (error) {
      console.error("Query ECPay Error:", error);
      if (options?.throwError) throw error;
      return null;
    }
  }

  async getStoreList(
    {
      CvsType,
    }: {
      CvsType:
        | "All"
        | "FAMI"
        | "UNIMART"
        | "HILIFE"
        | "OKMART"
        | "UNIMARTFREEZE";
    },
    options?: { throwError?: boolean },
  ) {
    const parameters: Record<string, any> = {
      MerchantID: process.env.LOGISTICS_MERCHANTID,
      CvsType,
    };

    const checkMacValue = this.generateCheckValue(
      parameters,
      process.env.LOGISTICS_HASH_KEY!,
      process.env.LOGISTICS_HASH_IV!,
      "md5",
    );

    parameters["CheckMacValue"] = checkMacValue;

    try {
      // 使用 axios 發送 POST 到綠界 (注意：不是 res.send(formHtml))
      const response = await axios.post(
        ECPAY_GET_STORE_LIST_URL,
        querystring.stringify(parameters), // 轉成 key=value&key2=value2 格式
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );

      const data = response.data;
      if (data.RtnCode !== 1 || !Array.isArray(data.StoreList))
        throw new Error("Invalid response from ECPay Get Store List API");

      return data.StoreList;
    } catch (error) {
      console.error("Query ECPay Error:", error);
      if (options?.throwError) throw error;
      return null;
    }
  }
}

export default new EcPayService();
