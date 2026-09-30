import { accountValidation } from "./account";
import { accountWalletValidation } from "./accountWallet";
import { advertisementValidation } from "./advertisement";
import { chatroomValidation } from "./chatroom";
import { deliveryValidation } from "./delivery";
import { fileValidation } from "./file";
import { orderValidation } from "./order";
import { productValidation } from "./product";
import { refundValidation } from "./refund";
import { systemValidation } from "./system";
import { dashboardValidation } from "./dashboard";
import { sidebarNotificationValidation } from "./sidebarNotification";

export const adminValidation = {
  account: accountValidation,
  accountWallet: accountWalletValidation,
  advertisement: advertisementValidation,
  chatroom: chatroomValidation,
  delivery: deliveryValidation,
  file: fileValidation,
  order: orderValidation,
  product: productValidation,
  refund: refundValidation,
  system: systemValidation,
  dashboard: dashboardValidation,
  sidebarNotification: sidebarNotificationValidation,
};
