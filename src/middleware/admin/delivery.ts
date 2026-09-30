import { z } from "zod";
import {
  HOME_DELIVERY_FEE,
  HOME_DELIVERY_REFRIG_FEE,
  OKMARTC2C_LOW_TMP_DELIVERY,
} from "../../constants/delivery";
import { ECPAY_SHIPPING_FEE } from "../../constants/ecpay";
import {
  dateTimeString,
  jsonObject,
  nonEmptyString,
  nonNegativeNumber,
  paginationQuery,
  requireAtLeastOneField,
  uuid,
} from "./common";

const deliveryStatus = z.enum([
  "pending",
  "shipped",
  "ready_for_pickup",
  "delivered",
  "returned",
  "cancelled",
  "exception",
  "unknown",
]);
const logisticsType = z.enum(["CVS", "home_delivery", "virtual"]);

export const deliveryValidation = {
  listQuery: paginationQuery.extend({
    merchantTradeNo: z.string().optional(),
    status: deliveryStatus.optional(),
    logisticsType: logisticsType.optional(),
    startDate: dateTimeString.optional(),
    endDate: dateTimeString.optional(),
  }),
  deliveryIdParams: z.object({
    deliveryId: uuid,
  }),
  updateBody: requireAtLeastOneField(
    z.object({
      status: deliveryStatus.optional(),
      AllPayLogisticsID: z.string().optional().nullable(),
      CVSPaymentNo: z.string().optional().nullable(),
      CVSValidationNo: z.string().optional().nullable(),
      LogisticsType: logisticsType.optional(),
      LogisticsSubType: z.string().optional().nullable(),
      RtnCode: z.string().optional().nullable(),
      RtnMsg: z.string().optional().nullable(),
      metadata: jsonObject.optional().nullable(),
      homeDeliveryData: jsonObject.optional().nullable(),
      cvsStoreInfo: jsonObject.optional().nullable(),
    }),
  ),
  printTradeDocumentQuery: z.object({
    token: nonEmptyString,
    LogisticsSubType: nonEmptyString,
    AllPayLogisticsID: nonEmptyString,
    CVSPaymentNo: z.string().optional(),
    CVSValidationNo: z.string().optional(),
  }),
  shippingFeeBody: requireAtLeastOneField(
    z.object({
      homeDelivery: nonNegativeNumber.max(HOME_DELIVERY_FEE).optional(),
      homeDeliveryRefrig: nonNegativeNumber
        .max(HOME_DELIVERY_REFRIG_FEE)
        .optional(),
      OKMART_LOW_TMP_C2C: nonNegativeNumber
        .max(OKMARTC2C_LOW_TMP_DELIVERY)
        .optional(),
      UNIMARTC2C: nonNegativeNumber
        .max(ECPAY_SHIPPING_FEE.UNIMARTC2C)
        .optional(),
      FAMIC2C: nonNegativeNumber.max(ECPAY_SHIPPING_FEE.FAMIC2C).optional(),
      HILIFEC2C: nonNegativeNumber
        .max(ECPAY_SHIPPING_FEE.HILIFEC2C)
        .optional(),
      OKMARTC2C: nonNegativeNumber
        .max(ECPAY_SHIPPING_FEE.OKMARTC2C)
        .optional(),
    }),
  ),
};
