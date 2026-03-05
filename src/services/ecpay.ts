import crypto from "crypto";
import {
  ECPAY_CHECKOUT_URL,
  ECPAY_LOGISTIC_BASE_URL,
} from "../constants/ecpay";
import { generateRandomString } from "../lib/general";

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
    let length = 0;
    for (let i = 0; i < str.length; i++) {
      // 檢查是否為中文字符或全形字符 (Unicode 編碼 > 255 的字符視為佔用 2 字元)
      if (str.charCodeAt(i) > 255) {
        length += 2;
      } else {
        length += 1;
      }
    }
    return length;
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
      const emojiRegex = /\p{Emoji}/u;
      if (emojiRegex.test(receiverNameStr)) {
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
        const emojiRegex = /\p{Emoji}/u;
        if (emojiRegex.test(senderNameStr)) {
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
        const specialCharRegex = /[\^'`!@#%&*+\\"<>|_\[\]‘”]/;
        if (specialCharRegex.test(goodsNameStr)) {
          return `商品名稱不得包含 ^ ‘ \` ! @ # % & * + \\ ” < > | _ [ ] 等特殊符號`;
        }

        // 再檢核是否有超過長度限制
        if (this.getEcpayLength(goodsNameStr) > 50) {
          return `商品名稱總長度超過 50 字元 (目前長度: ${this.getEcpayLength(
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
}

export default new EcPayService();
