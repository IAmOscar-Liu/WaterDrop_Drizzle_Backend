import { Delivery } from "../db/schema";
import { isCVSReadyForPickup } from "./polling";

export type LogisticsType =
  | "UNIMARTC2C"
  | "FAMIC2C"
  | "HILIFEC2C"
  | "OKMARTC2C";

export type LogisticsStatusMap = Record<
  string,
  { text: string; status: Delivery["status"] }
>;

export const logisticsStatus: Record<LogisticsType, LogisticsStatusMap> = {
  UNIMARTC2C: {
    "300": { text: "訂單處理中(綠界已收到訂單資料)", status: "pending" },

    "2030": { text: "物流中心驗收成功", status: "shipped" },

    "2041": { text: "物流中心關代引", status: "shipped" },
    "2042": { text: "包裹遺失，進入賠償程序", status: "exception" },
    "2043": { text: "門市配管昕前不配送，後續配送中", status: "shipped" },
    "2048": { text: "包裹異常，請洽客服", status: "exception" },

    "2051": { text: "賣家要求提早退貨", status: "returned" },
    "2053": { text: "門市關治關B，請洽客服", status: "exception" },
    "2058": { text: "天候不佳，後續配送中", status: "shipped" },

    "2061": { text: "包裹異常，請洽客服", status: "exception" },
    "2062": { text: "包裹異常，請洽客服", status: "exception" },
    "2066": { text: "包裹異常，請洽客服", status: "exception" },

    "2067": { text: "買家已到店取件", status: "delivered" },

    "2068": { text: "賣家已到門市寄件", status: "shipped" },
    "2069": { text: "退貨便收件(商品送回物流門市)", status: "returned" },

    "2070": { text: "賣家已取退回包裹", status: "returned" },

    "2072": { text: "包裹已送至物流作業廠市", status: "shipped" },
    "2073": { text: "包裹配至取件門市", status: "delivered" },

    "2074": { text: "買家未取包裹，將退回物流中心", status: "returned" },
    "2075": { text: "賣家未取包裹，將退回物流中心", status: "returned" },
    "2076": { text: "買家未取包裹，已退回物流中心", status: "returned" },

    "2077": { text: "賣家未取包裹，待申請退回", status: "returned" },

    "2078": { text: "買家未取包裹，已退回物流中心", status: "returned" },

    "2079": {
      text: "買家未取貨退回物流中心-商品瑕疵(經物流中心)",
      status: "returned",
    },

    "2080": { text: "買家未取貨退回物流中心-包材", status: "returned" },
    "2081": {
      text: "買家未取貨退回物流中心-滴落品(退貨及獨立配送)",
      status: "returned",
    },
    "2082": {
      text: "買家未取貨退回物流中心-訂單修改(極十店)",
      status: "returned",
    },

    "2083": {
      text: "買家未取貨退回物流中心-已到門市流轉中（本秒按發店關內寄系物流中心）",
      status: "returned",
    },

    "2084": {
      text: "買家未取貨退回物流中心-第一段據點轉箱流",
      status: "returned",
    },
    "2085": {
      text: "買家未取貨退回物流中心-第二段據點轉箱流",
      status: "returned",
    },
    "2086": {
      text: "買家未取貨退回物流中心-第一段據點資料轉遞",
      status: "returned",
    },
    "2087": {
      text: "買家未取貨退回物流中心-物流中心理作中",
      status: "returned",
    },
    "2088": { text: "買家未取貨退回物流中心-商品遺失", status: "exception" },

    "2089": {
      text: "買家未取貨退回物流中心-門市指定不能配送(六、日)",
      status: "returned",
    },

    "2092": { text: "買家未取退回物流中心-門市關勤", status: "returned" },
    "2093": { text: "買家未取退回物流中心-機場", status: "returned" },

    "2094": { text: "包裹異常，請洽客服", status: "exception" },

    "2096": { text: "賣家未取包裹，待申請退回", status: "returned" },

    "2097": { text: "賣家未取包裹，空運處理中", status: "returned" },

    "2098": { text: "包裹重新配達取件門市", status: "shipped" },
    "2099": { text: "包裹重新配達寄件門市", status: "shipped" },

    "2101": { text: "門市關轉店", status: "pending" },
    "2102": { text: "門市暫店或更新", status: "pending" },
    "2103": { text: "系統作門市更新", status: "pending" },
    "2104": { text: "門市關轉，請電選門市", status: "pending" },
    "2105": { text: "已申請門市變更", status: "pending" },

    "7013": { text: "訂單經過驗收期限（賣家未出貨）", status: "cancelled" },

    "7017": { text: "取件包裹異常，協查中", status: "exception" },
    "7018": { text: "包裹遺失，進入賠償程序", status: "exception" },
    "7019": { text: "寄件包裹異常，協查中", status: "exception" },
    "7020": { text: "包裹遺失，進入賠償程序", status: "exception" },

    "7038": { text: "門市驗收異常，請洽客服", status: "exception" },

    "9999": { text: "訂單取消", status: "cancelled" },
  },

  FAMIC2C: {
    "300": { text: "訂單處理中(綠界已收到訂單資料)", status: "pending" },
    "310": { text: "訂單上傳物流中", status: "pending" },

    "2105": { text: "已申請門市變更", status: "pending" },

    "3018": { text: "包裹配達取件門市", status: "shipped" },
    "3019": { text: "包裹已退至原寄件門市", status: "returned" },

    "3020": { text: "買家未取包裹，將退回物流中心", status: "returned" },
    "3021": { text: "賣家未取包裹，待申請退回", status: "returned" },

    "3022": { text: "賣家已到店取件", status: "delivered" },

    "3023": { text: "賣家已取退回包裹", status: "returned" },

    "3024": { text: "物流中心驗收成功", status: "shipped" },

    "3025": { text: "賣家未取包裹，已退回物流中心", status: "returned" },

    "3029": { text: "包裹已配送指定取件門市", status: "delivered" },

    "3031": { text: "包裹已退至指定寄件門市", status: "returned" },

    "3032": { text: "賣家已到門市寄件", status: "shipped" },

    "4001": { text: "買家已到門市寄件", status: "shipped" },

    "4002": { text: "退貨商品已至物流中心", status: "returned" },

    "5009": { text: "包裹異常，請洽客服", status: "exception" },

    "7006": { text: "包裹遺失，進入賠償程序", status: "exception" },
    "7007": { text: "包裹遺失，進入賠償程序", status: "exception" },

    "7008": { text: "包裹破損，請洽客服", status: "exception" },
    "7009": { text: "包裹異常，請洽客服", status: "exception" },
    "7010": { text: "包裹異常，請洽客服", status: "exception" },

    "7011": { text: "取件門市關閉，請重新選門市", status: "exception" },

    "7012": { text: "條碼錯誤，廠退處理", status: "exception" },

    "7013": { text: "訂單超過驗收期限（賣家未出貨）", status: "cancelled" },

    "7014": { text: "等待賣家出貨", status: "pending" },

    "7015": { text: "條碼重複，請洽客服", status: "exception" },

    "7016": { text: "包裹超材，退回賣家", status: "returned" },

    "7032": { text: "寄件門市關閉，請重新選門市", status: "exception" },

    "7034": { text: "貨物進店發生異常，請洽客服", status: "exception" },

    "7035": { text: "逾期未領，貨件銷毀", status: "returned" },

    "7036": { text: "貨件破損，請洽客服", status: "exception" },

    "7037": { text: "訂單上傳失敗", status: "cancelled" },
  },

  HILIFEC2C: {
    "300": { text: "訂單處理中(綠界已收到訂單資料)", status: "pending" },
    "310": { text: "訂單上傳物流中", status: "pending" },
    "311": { text: "訂單傳送物流成功", status: "pending" },
    "325": { text: "退貨訂單處理中(綠界已收到訂單資料)", status: "returned" },

    "2000": { text: "已申請門市變更", status: "pending" },
    "2001": { text: "訂單傳送超商成功", status: "pending" },
    "2002": { text: "出貨單號不合規則", status: "exception" },
    "2003": { text: "XML檔內容重複", status: "exception" },
    "2004": { text: "出貨單號重複上傳使用(驗收時發現)", status: "exception" },
    "2005": { text: "日期格式不符", status: "exception" },
    "2006": { text: "訂單金額或代收金額錯誤", status: "exception" },
    "2007": { text: "商品類型為空", status: "exception" },
    "2009": { text: "門市店號為空", status: "exception" },
    "2010": { text: "出貨日期為空", status: "exception" },
    "2011": { text: "出貨金額為空", status: "exception" },
    "2012": { text: "出貨編號不存在", status: "exception" },
    "2013": { text: "母廠商不存在", status: "exception" },
    "2014": { text: "子廠商不存在", status: "exception" },
    "2015": { text: "出貨編號已存在(單筆)", status: "exception" },
    "2016": { text: "門市已關轉店，將進行退貨處理", status: "returned" },
    "2017": { text: "出貨日期不符合規定", status: "exception" },
    "2018": {
      text: "服務類型不符規定(如只開取貨付款服務，卻使用純取貨服務)",
      status: "exception",
    },
    "2019": { text: "商品類型不符規定", status: "exception" },
    "2020": { text: "廠商尚未申請店配服務", status: "exception" },
    "2021": { text: "同一批次出貨編號重複(批次)", status: "exception" },
    "2022": { text: "出貨金額不符規定", status: "exception" },
    "2023": { text: "取貨人姓名為空", status: "exception" },
    "2024": { text: "訂單傳送超商成功", status: "pending" },
    "2025": { text: "門市關店撤(舊門市店號已更新)", status: "pending" },
    "2026": { text: "無此門市，將進行退貨處理", status: "returned" },
    "2027": { text: "門市指定時間不配送，後續配送中", status: "shipped" },
    "2028": {
      text: "門市關轉店，3日內未更新SUP(新店號)便至退貨流程",
      status: "pending",
    },
    "2029": { text: "門市尚未開店", status: "pending" },

    "2030": { text: "物流中心驗收成功", status: "shipped" },
    "2031": { text: "等待賣家出貨", status: "pending" },
    "2032": { text: "包裹異常，請洽客服", status: "exception" },
    "2033": { text: "包裹超材，退回賣家", status: "returned" },
    "2034": { text: "違禁品(違貨及廢棄處理)", status: "returned" },
    "2035": { text: "訂單資料重複上傳", status: "exception" },
    "2036": { text: "訂單超過驗收期限（賣家未出貨）", status: "cancelled" },
    "2037": { text: "取件門市關轉，請重選門市", status: "exception" },
    "2038": { text: "標籤錯誤，廠退處理", status: "exception" },
    "2039": { text: "標籤錯誤，廠退處理", status: "exception" },
    "2040": { text: "標籤錯誤，廠退處理", status: "exception" },

    "2041": { text: "物流中心理貨中", status: "shipped" },
    "2042": { text: "包裹遺失，進入賠償程序", status: "exception" },
    "2043": { text: "門市指定時間不配送，後續配送中", status: "shipped" },
    "2045": {
      text: "不正常到貨(商品提早到物流中心)，廠退處理",
      status: "returned",
    },
    "2046": { text: "條件未取退回大智物流中心", status: "returned" },
    "2047": {
      text: "正常二退(退貨時間延長，在到期期限內退回)",
      status: "returned",
    },
    "2048": { text: "包裹異常，請洽客服", status: "exception" },
    "2049": { text: "門市關店，將進行退貨處理", status: "returned" },
    "2050": { text: "門市關店，將進行退貨處理", status: "returned" },
    "2051": { text: "賣家要求提早退貨", status: "returned" },
    "2052": { text: "違禁品(退貨及廢棄處理)", status: "returned" },
    "2053": { text: "門市關A館，請洽客服", status: "exception" },
    "2054": { text: "賣家要求提早退貨", status: "returned" },
    "2055": { text: "包裹退至物流中心", status: "returned" },
    "2057": { text: "車輛故障，後續配送中", status: "shipped" },
    "2058": { text: "天候不佳，後續配送中", status: "shipped" },
    "2059": { text: "道路中斷，後續配送中", status: "shipped" },
    "2060": { text: "門市停業，廠退處理", status: "returned" },
    "2061": { text: "包裹異常，請洽客服", status: "exception" },
    "2062": { text: "包裹異常，請洽客服", status: "exception" },
    "2063": { text: "包裹配達取件門市", status: "delivered" },
    "2065": { text: "買家未取包裹，將退回物流中心", status: "returned" },
    "2066": { text: "包裹異常，請洽客服", status: "exception" },
    "2067": { text: "買家已到店取貨", status: "delivered" },
    "2068": { text: "賣家已到門市寄件", status: "shipped" },
    "2069": { text: "退貨便收件(商品退回指定C門市)", status: "returned" },
    "2070": { text: "賣家已取退回包裹", status: "returned" },
    "2071": { text: "門市代碼格式錯誤", status: "exception" },
    "2072": { text: "包裹已退至原寄件門市", status: "returned" },
    "2073": { text: "包裹配達取件門市", status: "delivered" },
    "2074": { text: "買家未取包裹，將退回物流中心", status: "returned" },
    "2075": { text: "買家未取包裹，將退回物流中心", status: "returned" },

    "2101": { text: "門市關轉店", status: "pending" },
    "2102": { text: "門市暫店更新", status: "pending" },
    "2103": { text: "無取件門市資料", status: "exception" },
    "2104": { text: "門市關轉，請重新選門市", status: "pending" },
    "2105": { text: "已申請門市變更", status: "pending" },

    "3018": { text: "包裹配達取件門市", status: "delivered" },
    "3019": { text: "包裹已退至原寄件門市", status: "returned" },
    "3020": { text: "買家未取包裹，將退回物流中心", status: "returned" },
    "3021": { text: "賣家未取包裹，待申請退回", status: "returned" },
    "3022": { text: "買家已到店取貨", status: "delivered" },
    "3023": { text: "賣家已取退回包裹", status: "returned" },
    "3024": { text: "物流中心驗收成功", status: "shipped" },
    "3025": { text: "買家未取包裹，已退回物流中心", status: "returned" },
    "3029": { text: "包裹已配送指定取件門市", status: "shipped" },
    "3031": { text: "包裹已退至指定寄件門市", status: "returned" },
    "3032": { text: "賣家已到門市寄件", status: "shipped" },
    "3033": { text: "EC客戶要求提早退貨", status: "returned" },

    "4001": { text: "賣家已到門市寄件", status: "shipped" },
    "4002": { text: "退貨商品已至物流中心", status: "returned" },

    "5001": { text: "損壞，站所聯絡協助退貨", status: "exception" },
    "5002": { text: "遺失", status: "exception" },
    "5003": { text: "BASE列管(寄件人和收件人聯絡不到)", status: "exception" },
    "5004": { text: "賣家未取包裹，待申請退回", status: "returned" },
    "5005": { text: "代收退貨", status: "returned" },
    "5006": { text: "代收毀損", status: "exception" },
    "5007": { text: "代收遺失", status: "exception" },
    "5008": { text: "退貨配達", status: "returned" },
    "5009": { text: "包裹異常，請洽客服", status: "exception" },

    "7001": { text: "超大(通常發生於司機取件，不取件)", status: "exception" },
    "7002": { text: "超重(通常發生於司機取件，不取件)", status: "exception" },
    "7003": { text: "地址錯誤，聯繫收件人", status: "exception" },
    "7004": { text: "航班延誤", status: "shipped" },
    "7005": { text: "託運單刪除", status: "cancelled" },
    "7006": { text: "包裹遺失，進入賠償程序", status: "exception" },
    "7007": { text: "包裹遺失，進入賠償程序", status: "exception" },
    "7008": { text: "包裹破損，請洽客服", status: "exception" },
    "7009": { text: "包裹異常，請洽客服", status: "exception" },
    "7010": { text: "包裹異常，請洽客服", status: "exception" },
    "7011": { text: "取件門市關閉，請重選門市", status: "exception" },
    "7012": { text: "條碼錯誤，廠退處理", status: "exception" },
    "7013": { text: "訂單超過驗收期限（賣家未出貨）", status: "cancelled" },
    "7014": { text: "等待賣家出貨", status: "pending" },
    "7016": { text: "包裹超材，退回賣家", status: "returned" },
    "7032": { text: "寄件門市關閉，請重選門市", status: "exception" },

    "9001": { text: "退貨已取", status: "returned" },
    "9002": { text: "退貨已取", status: "returned" },

    "9999": { text: "訂單取消", status: "cancelled" },
  },

  OKMARTC2C: {
    "300": { text: "訂單處理中(綠界已收到訂單資料)", status: "pending" },

    "2030": { text: "物流中心驗收成功", status: "shipped" },

    "2055": { text: "包裹退至物流中心", status: "returned" },

    "2072": { text: "包裹已退至原寄件門市", status: "returned" },

    "2073": { text: "包裹配達取件門市", status: "delivered" },

    "2074": { text: "買家未取包裹，將退回物流中心", status: "returned" },
    "2075": { text: "賣家未取包裹，將退回物流中心", status: "returned" },
    "2078": { text: "賣家未取包裹，已退回物流中心", status: "returned" },

    "2105": { text: "已申請門市變更", status: "pending" },

    "3021": { text: "賣家未取包裹，待申請退回", status: "returned" },

    "3022": { text: "買家已到店取貨", status: "delivered" },

    "3023": { text: "賣家已取退回包裹", status: "returned" },

    "3032": { text: "賣家已到門市寄件", status: "shipped" },

    "7101": { text: "取件門市關轉，請重選門市", status: "exception" },

    "7102": { text: "包裹配送驗收異常-無進貨資料", status: "exception" },
    "7103": { text: "包裹配送驗收異常-條碼錯誤", status: "exception" },
    "7104": { text: "包裹配送驗收異常-超材", status: "exception" },
    "7105": {
      text: "包裹配送驗收異常-大物流包裝不良(滲漏)",
      status: "exception",
    },
    "7106": { text: "包裹配送驗收異常-小物流破損", status: "exception" },
    "7107": {
      text: "包裹配送驗收異常-門市反應商品包裝不良(滲漏)",
      status: "exception",
    },

    "7201": { text: "寄件門市關轉，請重選門市", status: "exception" },

    "7202": { text: "退貨包裹配送驗收異常-無進貨資料", status: "exception" },
    "7203": { text: "退貨包裹配送驗收異常-條碼錯誤", status: "exception" },
    "7204": { text: "退貨包裹配送驗收異常-超材", status: "exception" },
    "7205": {
      text: "退貨包裹配送驗收異常-大物流包裝不良(滲漏)",
      status: "exception",
    },
    "7206": { text: "退貨包裹配送驗收異常-小物流破損", status: "exception" },
    "7207": {
      text: "退貨包裹配送驗收異常-門市反應商品包裝不良(滲漏)",
      status: "exception",
    },

    "7255": { text: "包裹退至物流中心", status: "returned" },
  },
};

export function getLogisticsStatus(type: LogisticsType, code: string | number) {
  const normalizedCode = String(code);
  const readyForPickup = isCVSReadyForPickup("CVS", type, normalizedCode);
  if (readyForPickup) return "ready_for_pickup";
  return logisticsStatus[type]?.[normalizedCode]?.status ?? "unknown";
}

export function getLogisticsStatusText(
  type: LogisticsType,
  code: string | number,
): string {
  const normalizedCode = String(code);
  return (
    logisticsStatus[type]?.[normalizedCode]?.text ??
    `未知物流狀態 (${normalizedCode})`
  );
}

export function hasLogisticsStatus(
  type: LogisticsType,
  code: string | number,
): boolean {
  return String(code) in logisticsStatus[type];
}
