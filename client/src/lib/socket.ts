import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  return socket;
}

export function openSocket(): Socket {
  socket?.disconnect();
  socket = io({ path: '/socket.io', transports: ['websocket', 'polling'], withCredentials: true });
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
}
