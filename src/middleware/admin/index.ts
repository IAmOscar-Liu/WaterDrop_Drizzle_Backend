import { accountValidation } from "./account";
import { advertisementValidation } from "./advertisement";
import { chatroomValidation } from "./chatroom";
import { deliveryValidation } from "./delivery";
import { fileValidation } from "./file";
import { orderValidation } from "./order";
import { productValidation } from "./product";
import { systemValidation } from "./system";

export const adminValidation = {
  account: accountValidation,
  advertisement: advertisementValidation,
  chatroom: chatroomValidation,
  delivery: deliveryValidation,
  file: fileValidation,
  order: orderValidation,
  product: productValidation,
  system: systemValidation,
};
