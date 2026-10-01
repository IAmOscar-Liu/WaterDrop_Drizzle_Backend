export type ServiceResponseFailure = {
  success: false;
  statusCode?: number;
  message: any;
  code?: string;
};

export type ServiceResponse<T> =
  | {
      success: true;
      statusCode?: number;
      data: T;
    }
  | ServiceResponseFailure;
