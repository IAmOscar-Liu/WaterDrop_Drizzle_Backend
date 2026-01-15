import crypto from "crypto";
import { generateRandomString } from "../lib/general";

class EcPayService {
  generateTradeNo() {
    // return "test" + new Date().getTime();
    return generateRandomString(20);
  }

  generateMerchantTradeDate() {
    return new Date().toLocaleString("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "UTC",
    });
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
          parameters[key]
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
        checkMacValueOptions.algorithm ?? "sha256"
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
    algorithm: string = "sha256"
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
      ReceiverName,
      ReceiverCellPhone,
      ReceiverEmail,
      GoodsName,
      GoodsAmount,
    } = params;

    // 1. 驗證 ReceiverName (收件人姓名)
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

    // 2. 驗證 ReceiverCellPhone (收件人手機): 規定長度為 10 碼數字
    const phoneRegex = /^09\d{8}$/;
    if (ReceiverCellPhone && !phoneRegex.test(String(ReceiverCellPhone))) {
      return `收件人手機格式錯誤，須為 09 開頭的 10 碼數字`;
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
    if (GoodsName) {
      const goodsNameStr = String(GoodsName);

      // 優先檢核是否有特殊字元
      const specialCharRegex = /[\^'`!@#%&*+\\"<>|_\[\]‘”]/;
      if (specialCharRegex.test(goodsNameStr)) {
        return `商品名稱不得包含 ^ ‘ \` ! @ # % & * + \\ ” < > | _ [ ] 等特殊符號`;
      }

      // 再檢核是否有超過長度限制
      if (this.getEcpayLength(goodsNameStr) > 50) {
        return `商品名稱總長度超過 50 字元 (目前長度: ${this.getEcpayLength(
          goodsNameStr
        )})`;
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
      return "https://logistics-stage.ecpay.com.tw/Express/PrintUniMartC2COrderInfo";
    if (LogisticsSubType === "FAMIC2C")
      return "https://logistics-stage.ecpay.com.tw/Express/PrintFAMIC2COrderInfo";
    if (LogisticsSubType === "OKMARTC2C")
      return "https://logistics-stage.ecpay.com.tw/Express/PrintOKMARTC2COrderInfo";
    return "https://logistics-stage.ecpay.com.tw/helper/printTradeDocument";
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
    }
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
