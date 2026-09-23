/** Transport notifications carry no authority; the host owns the peer identity. */
export type ClientTransportEvent = unknown;

/** Private adapter interface. Only createClientAPI's named methods reach UI code. */
export interface ClientTransport {
  invoke(method: string, payload?: unknown): Promise<unknown>;
  on<T>(channel: string, listener: (event: ClientTransportEvent, payload: T) => void): void;
  removeListener<T>(
    channel: string,
    listener: (event: ClientTransportEvent, payload: T) => void,
  ): void;
}
