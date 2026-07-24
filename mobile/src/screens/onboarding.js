// Onboarding & auth screens: boot, welcome, sign-in (with optional TOTP),
// sign-up, password reset, bank linking (with account confirmation + PIN
// set/confirm), and the session lock screen.
//
// UX rules applied here:
//  - every control carries an accessibility role/label/state
//  - account number must be typed twice and must match (accountsMatch)
//  - all inputs validate client-side before any network call
//  - errors surface as human copy (humanError), never machine codes
import React, { useState } from "react";
import { View, Text, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useApp } from "./context.js";
import { Brand, Card, ScreenHeader, Field, PrimaryButton, PinDots, PinPad } from "../ui.js";
import { useTheme } from "../theme.js";
import { rs } from "../responsive.js";
import { t } from "../i18n.js";
import { humanError } from "../errors.js";
import {
  accountIssue,
  accountsMatch,
  ifscIssue,
  nameIssue,
} from "../validation.js";

const PIN_LENGTH = 4;

function Screen({ children }) {
  const palette = useTheme();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: palette.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: rs(20), paddingBottom: rs(40) }}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ErrorText({ children }) {
  const palette = useTheme();
  if (!children) return null;
  return (
    <Text accessibilityRole="alert" style={{ color: palette.danger, fontSize: rs(13), marginTop: rs(10), textAlign: "center" }}>
      {children}
    </Text>
  );
}

export function BootScreen() {
  const palette = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: palette.bg, alignItems: "center", justifyContent: "center" }}>
      <Brand subtitle={t("sandbox_mode")} />
      <ActivityIndicator color={palette.accent} style={{ marginTop: rs(24) }} />
    </View>
  );
}

export function WelcomeScreen() {
  const { setScreen } = useApp();
  const palette = useTheme();
  return (
    <Screen>
      <View style={{ alignItems: "center", marginTop: rs(48), marginBottom: rs(32) }}>
        <Brand subtitle="Borderless payments, at home and abroad" />
      </View>
      <PrimaryButton title={t("sign_in")} onPress={() => setScreen("signin")} />
      <View style={{ height: rs(12) }} />
      <PrimaryButton title={t("create_account")} secondary onPress={() => setScreen("signup")} />
      <Text style={{ color: palette.muted, fontSize: rs(12), textAlign: "center", marginTop: rs(24) }}>
        {t("sandbox_mode")}
      </Text>
    </Screen>
  );
}

export function SigninScreen() {
  const { setScreen, handleLogin } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [totpNeeded, setTotpNeeded] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    if (!email.trim() || !password) { setErr("Enter your email and password."); return; }
    if (totpNeeded && totp.trim().length < 6) { setErr("Enter the 6-digit code from your authenticator app."); return; }
    setErr(""); setBusy(true);
    try {
      const result = await handleLogin(email.trim(), password, totpNeeded ? totp.trim() : undefined);
      if (result === "totp") setTotpNeeded(true);
    } catch (e) { setErr(humanError(e)); }
    finally { setBusy(false); }
  };

  return (
    <Screen>
      <ScreenHeader title={t("sign_in")} onBack={() => setScreen("welcome")} />
      <Card>
        <Field label={t("email")} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} editable={!totpNeeded} returnKeyType="next" />
        <Field label={t("password")} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" editable={!totpNeeded} returnKeyType={totpNeeded ? "next" : "done"} onSubmitEditing={totpNeeded ? undefined : onSubmit} />
        {totpNeeded && (
          <Field label={t("totp")} value={totp} onChangeText={setTotp} keyboardType="number-pad" maxLength={6} returnKeyType="done" onSubmitEditing={onSubmit} />
        )}
      </Card>
      <PrimaryButton title={t("sign_in")} onPress={onSubmit} loading={busy} disabled={busy} />
      <View style={{ height: rs(12) }} />
      <PrimaryButton title={t("forgot_password")} secondary onPress={() => setScreen("forgot")} />
      <ErrorText>{err}</ErrorText>
    </Screen>
  );
}

export function SignupScreen() {
  const { setScreen, handleSignup } = useApp();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    const nameProblem = nameIssue(name);
    if (nameProblem) { setErr(humanError(nameProblem)); return; }
    if (!email.trim()) { setErr("Enter your email address."); return; }
    if (password.length < 8) { setErr("Choose a password of at least 8 characters."); return; }
    setErr(""); setBusy(true);
    try { await handleSignup(name.trim(), email.trim(), password); }
    catch (e) { setErr(humanError(e)); }
    finally { setBusy(false); }
  };

  return (
    <Screen>
      <ScreenHeader title={t("create_account")} onBack={() => setScreen("welcome")} />
      <Card>
        <Field label={t("account_holder")} value={name} onChangeText={setName} autoCapitalize="words" returnKeyType="next" />
        <Field label={t("email")} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} returnKeyType="next" />
        <Field label={t("password")} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" returnKeyType="done" onSubmitEditing={onSubmit} />
      </Card>
      <PrimaryButton title={t("create_account")} onPress={onSubmit} loading={busy} disabled={busy} />
      <ErrorText>{err}</ErrorText>
      <Text style={{ color: useTheme().muted, fontSize: rs(11), textAlign: "center", marginTop: rs(16) }}>
        By continuing you accept the Terms of Service (v1.0) and Privacy Policy (v1.0).
      </Text>
    </Screen>
  );
}

export function ResetScreen() {
  const { setScreen, handleForgotRequest, handleResetConfirm } = useApp();
  const [stage, setStage] = useState("request");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const palette = useTheme();

  const onRequest = async () => {
    if (!email.trim()) { setErr("Enter your email address."); return; }
    setErr(""); setBusy(true);
    try {
      await handleForgotRequest(email.trim());
      setStage("confirm");
      setInfo("If that email is registered, a reset code has been sent. Enter it below.");
    } catch (e) { setErr(humanError(e)); }
    finally { setBusy(false); }
  };

  const onConfirm = async () => {
    if (!token.trim()) { setErr("Enter the reset code you received."); return; }
    if (newPassword.length < 8) { setErr("Choose a password of at least 8 characters."); return; }
    setErr(""); setBusy(true);
    try {
      await handleResetConfirm(token.trim(), newPassword);
      setInfo("Password updated. Please sign in.");
      setScreen("signin");
    } catch (e) { setErr(humanError(e)); }
    finally { setBusy(false); }
  };

  return (
    <Screen>
      <ScreenHeader title={t("reset_password")} onBack={() => setScreen("signin")} />
      {info ? <Text style={{ color: palette.muted, fontSize: rs(13), marginBottom: rs(12), textAlign: "center" }}>{info}</Text> : null}
      {stage === "request" ? (
        <>
          <Card>
            <Field label={t("email")} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} returnKeyType="done" onSubmitEditing={onRequest} />
          </Card>
          <PrimaryButton title={t("send_reset_code")} onPress={onRequest} loading={busy} disabled={busy} />
        </>
      ) : (
        <>
          <Card>
            <Field label={t("reset_code")} value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} returnKeyType="next" />
            <Field label={t("new_password")} value={newPassword} onChangeText={setNewPassword} secureTextEntry autoCapitalize="none" returnKeyType="done" onSubmitEditing={onConfirm} />
          </Card>
          <PrimaryButton title={t("reset_password")} onPress={onConfirm} loading={busy} disabled={busy} />
        </>
      )}
      <ErrorText>{err}</ErrorText>
    </Screen>
  );
}

export function LinkScreen() {
  const { handleLink, confirmLogout } = useApp();
  const palette = useTheme();
  const [stage, setStage] = useState("form");
  const [account, setAccount] = useState("");
  const [confirmAccount, setConfirmAccount] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [holder, setHolder] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [pinBuf, setPinBuf] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const onContinue = () => {
    const accountProblem = accountIssue(account);
    if (accountProblem) { setErr(humanError(accountProblem)); return; }
    if (!accountsMatch(account, confirmAccount)) { setErr(t("account_mismatch")); return; }
    const ifscProblem = ifscIssue(ifsc);
    if (ifscProblem) { setErr(humanError(ifscProblem)); return; }
    const nameProblem = nameIssue(holder);
    if (nameProblem) { setErr(humanError(nameProblem)); return; }
    setErr("");
    setStage("pin-set");
  };

  const submitLink = async (pin) => {
    setBusy(true);
    try {
      await handleLink({ account: account.trim(), ifsc: ifsc.trim().toUpperCase(), name: holder.trim() }, pin);
    } catch (e) {
      setErr(humanError(e));
      setStage("pin-set"); setFirstPin(""); setPinBuf("");
    } finally { setBusy(false); }
  };

  const onPinKey = (key) => {
    if (busy) return;
    setErr("");
    if (key === "del") { setPinBuf((p) => p.slice(0, -1)); return; }
    if (pinBuf.length >= PIN_LENGTH) return;
    const next = pinBuf + key;
    setPinBuf(next);
    if (next.length < PIN_LENGTH) return;
    if (stage === "pin-set") {
      setFirstPin(next); setPinBuf(""); setStage("pin-confirm");
    } else {
      if (next !== firstPin) {
        setErr("PINs do not match. Try again.");
        setFirstPin(""); setPinBuf(""); setStage("pin-set"); return;
      }
      setPinBuf(""); submitLink(next);
    }
  };

  if (stage !== "form") {
    return (
      <Screen>
        <ScreenHeader title={stage === "pin-set" ? t("set_pin") : t("confirm_pin")} onBack={() => { setStage("form"); setFirstPin(""); setPinBuf(""); setErr(""); }} />
        <Text style={{ color: palette.muted, fontSize: rs(14), textAlign: "center", marginBottom: rs(20) }}>
          {stage === "pin-set" ? "Choose a 4-digit PIN. You will confirm every payment with it." : "Enter the same PIN once more to confirm."}
        </Text>
        <PinDots filled={pinBuf.length} total={PIN_LENGTH} />
        <View style={{ height: rs(20) }} />
        <PinPad onKey={onPinKey} />
        {busy && <ActivityIndicator color={palette.accent} style={{ marginTop: rs(16) }} />}
        <ErrorText>{err}</ErrorText>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title={t("link_bank")} />
      <Text style={{ color: palette.muted, fontSize: rs(13), marginBottom: rs(12) }}>
        Link the bank account that will fund your payments. Typing the account number twice protects you from a mistyped digit.
      </Text>
      <Card>
        <Field label={t("account_number")} value={account} onChangeText={setAccount} keyboardType="number-pad" maxLength={18} returnKeyType="next" />
        <Field label={t("confirm_account")} value={confirmAccount} onChangeText={setConfirmAccount} keyboardType="number-pad" maxLength={18} error={confirmAccount.length > 0 && !accountsMatch(account, confirmAccount) ? t("account_mismatch") : ""} returnKeyType="next" />
        <Field label={t("ifsc")} value={ifsc} onChangeText={(v) => setIfsc(v.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={11} returnKeyType="next" />
        <Field label={t("account_holder")} value={holder} onChangeText={setHolder} autoCapitalize="words" returnKeyType="done" onSubmitEditing={onContinue} />
      </Card>
      <PrimaryButton title={t("continue")} onPress={onContinue} />
      <View style={{ height: rs(12) }} />
      <PrimaryButton title={t("sign_out")} secondary onPress={confirmLogout} />
      <ErrorText>{err}</ErrorText>
    </Screen>
  );
}

export function LockScreen() {
  const { unlockWithDevice, confirmLogout, lockState, name } = useApp();
  const palette = useTheme();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const onUnlock = async () => {
    setErr(""); setBusy(true);
    try { await unlockWithDevice(); }
    catch (e) { setErr(humanError(e)); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.bg, alignItems: "center", justifyContent: "center", padding: rs(24) }}>
      <Brand subtitle={name ? `Welcome back, ${name}` : "Welcome back"} />
      <View style={{ height: rs(28) }} />
      <PrimaryButton title={busy ? t("unlocking") : t("unlock")} onPress={onUnlock} loading={busy} disabled={busy || lockState === "busy"} style={{ alignSelf: "stretch" }} />
      <View style={{ height: rs(12) }} />
      <PrimaryButton title={t("sign_out")} secondary onPress={confirmLogout} style={{ alignSelf: "stretch" }} />
      <ErrorText>{err}</ErrorText>
    </View>
  );
}
