// Camera QR scanner — WEB build (react-native-web, used by `npm run sim`).
//
// We deliberately do NOT import expo-camera on web. Its web implementation
// builds a Web Worker that loads jsQR from a hardcoded CDN
// (`https://cdn.jsdelivr.net/npm/jsqr@1.2.0/...`) at *import time* — so it
// throws a page error on every load (even the welcome screen) and cannot work
// offline or under a strict CSP. Pulling third-party script into a payments app
// at runtime is also undesirable on its own.
//
// Instead, the web build scans QR codes the way a MOBILE browser would:
//   • <WebQrScanner/> opens the real camera via getUserMedia — the browser
//     shows its own in-context permission prompt — and decodes frames with
//     the native BarcodeDetector when the browser has one (Chrome on
//     Android/macOS, i.e. actual phones), falling back to a locally bundled
//     jsQR (same decoder expo-camera uses, but from node_modules — no CDN,
//     works offline) everywhere else.
//   • Decoded payloads flow into the SAME hardened `upi://pay…` parser the
//     native app uses, so scanning a physical UPI QR in a phone's browser
//     behaves exactly like the native app.
// When no camera API exists at all (http over LAN, headless, no webcam), the
// scan screen in App.js falls back to a clearly-labelled simulated scan that
// still routes a demo UPI payload through the real parser.
//
// The expo-camera stubs below exist only so App.js can import the scanner from
// a single path on every platform; the native branch never renders these.
import React, { useEffect, useRef } from "react";
import jsQR from "jsqr";

export function CameraView() {
  return null;
}

const WEB_CAM_PERM = { granted: false, canAskAgain: true, status: "undetermined" };

export function useCameraPermissions() {
  return [WEB_CAM_PERM, async () => WEB_CAM_PERM];
}

// True when this browser can even ask for a camera. getUserMedia requires a
// secure context: https or localhost. (Opening the sim on a phone over plain
// http LAN → false → the simulated scanner is used; `adb reverse` the port to
// get the phone's real camera — see mobile/README.)
export function webCameraCapable() {
  return typeof navigator !== "undefined" && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

// Live camera + on-device QR decode. Calls onScanned({ data }) for every
// decoded payload (the caller de-dupes/validates), onError(e) when the camera
// can't start (e.name === "NotAllowedError" when the user denies the browser
// prompt). Renders a plain <video> — react-native-web is react-dom underneath,
// so DOM elements compose fine inside Views.
export function WebQrScanner({ onScanned, onError }) {
  const videoRef = useRef(null);
  const cbRef = useRef({ onScanned, onError });
  cbRef.current = { onScanned, onError };

  useEffect(() => {
    let stream = null;
    let timer = null;
    let stopped = false;
    let detector = null;
    let canvas = null;
    let ctx = null;

    if (typeof window !== "undefined" && "BarcodeDetector" in window) {
      try {
        detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      } catch {
        detector = null; // fall through to jsQR
      }
    }

    async function tick() {
      if (stopped) return;
      const v = videoRef.current;
      if (v && v.readyState >= 2 && v.videoWidth > 0) {
        try {
          if (detector) {
            const codes = await detector.detect(v);
            if (!stopped && codes && codes.length && codes[0].rawValue) {
              cbRef.current.onScanned({ data: codes[0].rawValue });
            }
          } else {
            if (!canvas) {
              canvas = document.createElement("canvas");
              ctx = canvas.getContext("2d", { willReadFrequently: true });
            }
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
            if (!stopped && code && code.data) {
              cbRef.current.onScanned({ data: code.data });
            }
          }
        } catch {
          // a single bad frame is not an error — keep scanning
        }
      }
      timer = setTimeout(tick, 250);
    }

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" }, // back camera on phones
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const v = videoRef.current;
        v.srcObject = stream;
        await v.play();
        tick();
      } catch (e) {
        if (!stopped) cbRef.current.onError && cbRef.current.onError(e);
      }
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return React.createElement("video", {
    ref: videoRef,
    muted: true,
    playsInline: true,
    style: { width: "100%", height: "100%", objectFit: "cover" },
  });
}
