import { io, type Socket } from 'socket.io-client';
import { API_ORIGIN, getToken, IS_APP } from './env';

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  return socket;
}

export function openSocket(): Socket {
  socket?.disconnect();
  const opts = {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    withCredentials: !IS_APP,
    // Read the token on every (re)connect so a new sign-in is picked up.
    auth: (cb: (data: object) => void) => cb(getToken() ? { token: getToken() } : {}),
  };
  socket = IS_APP ? io(API_ORIGIN, opts) : io(opts);
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
}
