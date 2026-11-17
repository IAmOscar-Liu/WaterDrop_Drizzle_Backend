import { reverseShippingSubsidy } from "../repository/shippingReimbursement";
import * as earnings from "../repository/sellerEarnings";
import * as requests from "../repository/walletRequest";
import { retrySellerAutoRefills } from "../repository/adAutomation";
import { handleServiceError } from "../lib/error";
async function wrap<T>(fn:()=>Promise<T>) {try{return {success:true as const,data:await fn()};}catch(error){return handleServiceError(error);}}
export default {
  reverseShipping:(...args:Parameters<typeof reverseShippingSubsidy>)=>wrap(()=>reverseShippingSubsidy(...args)),
  summary:(...args:Parameters<typeof earnings.earningsSummary>)=>wrap(()=>earnings.earningsSummary(...args)),
  history:(...args:Parameters<typeof earnings.earningsHistory>)=>wrap(()=>earnings.earningsHistory(...args)),
  adjust:(...args:Parameters<typeof earnings.adjustRevenue>)=>wrap(()=>earnings.adjustRevenue(...args)),
  requests:(...args:Parameters<typeof requests.listWalletRequests>)=>wrap(()=>requests.listWalletRequests(...args)),
  create:(...args:Parameters<typeof requests.createWalletRequest>)=>wrap(()=>requests.createWalletRequest(...args)),
  review:(...args:Parameters<typeof requests.reviewWalletRequest>)=>wrap(async()=>{
    const result=await requests.reviewWalletRequest(...args);
    if(result.wallet==="advertising"&&result.direction==="deposit"&&result.status==="completed") {
      // Deposit is committed. A refill error must never turn a confirmed receipt into a failed deposit.
      await retrySellerAutoRefills(result.sellerId).catch(error=>console.error("Deposit auto-refill failed",{requestId:result.id,error}));
    }
    return result;
  }),
};
