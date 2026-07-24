// Auth + Settle screens.
// Auth: PIN pad, or biometric prompt.
// Settle: progress advances with REAL backend response, NOT a timer.
//   • Steps advance up to (steps.length-1) while the request is in-flight.
//   • The final step only completes when the backend responds successfully.
//   • On error the screen shows the real error, not a timeout.
import React, { useEffect, useRef, useState } from "react";
import { View, Text, Animated } from "react-native";
import { useApp } from "./context.js";
import { Brand, PinDots, PinPad, PrimaryButton, Card } from "../ui.js";
import { useTheme } from "../theme.js";
import { rs } from "../responsive.js";
import { t } from "../i18n.js";

const TICK_MS = 600;

export function AuthScreen() {
  const C = useTheme();
  const { pin, onPinKey, busy, error, runBiometric, flow } = useApp();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, padding: rs(24) }}>
      <Brand subtitle={t("enter_pin")} />
      <PinDots filled={pin.length} />
      <PinPad onKey={onPinKey} />
      {Boolean(error) && (
        <Text style={{ color: C.danger, textAlign: "center", marginTop: rs(12) }} accessibilityRole="alert">{error}</Text>
      )}
      {Boolean(busy) && (
        <Text style={{ color: C.muted, textAlign: "center", marginTop: rs(8) }}>{t("authorizing")}</Text>
      )}
    </View>
  );
}

export function SettleScreen() {
  const C = useTheme();
  const { settleSteps, settleStepIndex, settleError, settleRetry, setScreen } = useApp();
  const steps = settleSteps || [t("settle_step_sending"), t("settle_step_routing"), t("settle_step_confirming"), t("settle_step_recording"), t("settle_step_complete")];
  const currentStep = settleStepIndex !== undefined ? settleStepIndex : 0;
  const failed = Boolean(settleError);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: "center", padding: rs(32) }}>
      <Text
        style={{ fontSize: rs(22), fontWeight: "700", color: C.text, textAlign: "center", marginBottom: rs(32) }}
        accessibilityRole="header"
      >
        {failed ? t("settle_failed") : t("settling")}
      </Text>

      {steps.map((step, i) => {
        const done = i < currentStep;
        const active = i === currentStep && !failed;
        return (
          <View
            key={step}
            style={{ flexDirection: "row", alignItems: "center", marginBottom: rs(16) }}
            accessibilityLabel={`${step}: ${done ? "done" : active ? "in progress" : "pending"}`}
          >
            <View
              style={{
                width: rs(20), height: rs(20), borderRadius: rs(10),
                backgroundColor: done ? C.good : active ? C.accent2 : C.border,
                marginRight: rs(12),
              }}
            />
            <Text style={{ fontSize: rs(15), color: done ? C.good : active ? C.text : C.muted, fontWeight: done || active ? "600" : "400" }}>
              {step}
            </Text>
          </View>
        );
      })}

      {failed && (
        <>
          <Text style={{ color: C.danger, textAlign: "center", marginBottom: rs(16) }} accessibilityRole="alert">
            {settleError}
          </Text>
          <PrimaryButton title={t("settle_retry")} onPress={settleRetry} />
        </>
      )}
    </View>
  );
}
