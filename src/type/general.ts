export type ServiceResponseFailure = {
  success: false;
  statusCode?: number;
  message: any;
};

export type ServiceResponse<T> =
  | {
      success: true;
      statusCode?: number;
      data: T;
    }
  | ServiceResponseFailure;
