export enum HTTPStatusCode {
    InnerError = -2,
    Error = -1,
    Timeout = 0,
    OK = 200,
    Forbidden = 403,
    TooManyRequests = 429,
}
