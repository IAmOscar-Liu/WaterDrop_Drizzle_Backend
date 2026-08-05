import { z } from "zod";
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
      homeDelivery: nonNegativeNumber.max(60).optional(),
      homeDeliveryRefrig: nonNegativeNumber.max(160).optional(),
      OKMART_LOW_TMP_C2C: nonNegativeNumber.max(160).optional(),
      UNIMARTC2C: nonNegativeNumber.max(69).optional(),
      FAMIC2C: nonNegativeNumber.max(69).optional(),
      HILIFEC2C: nonNegativeNumber.max(58).optional(),
      OKMARTC2C: nonNegativeNumber.max(58).optional(),
    }),
  ),
};
