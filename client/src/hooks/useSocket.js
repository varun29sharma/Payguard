import { useEffect, useRef } from "react";
import { io } from "socket.io-client";
import api from "../api/axiosConfig";
import { probeBackend } from "../utils/probeBackend";

export const useSocket = () => {
  const socketRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    async function init() {
      try {
        const ok = await probeBackend();
        if (!ok) {
          socketRef.current = {
            connected: false,
            on: () => {},
            off: () => {},
            disconnect: () => {},
          };
          return;
        }
        if (!mounted) return;
        socketRef.current = io("http://localhost:3000");
      } catch (err) {
        socketRef.current = {
          connected: false,
          on: () => {},
          off: () => {},
          disconnect: () => {},
        };
      }
    }
    init();

    return () => {
      mounted = false;
      if (socketRef.current && socketRef.current.disconnect) {
        try {
          socketRef.current.disconnect();
        } catch (e) {}
      }
    };
  }, []);

  return socketRef.current;
};
