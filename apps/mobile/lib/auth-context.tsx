import type { Session } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, type AppStateStatus } from "react-native";

import { authErrorMessage } from "./club";
import { parseAuthRedirect } from "./deep-link";
import { getSupabase } from "./supabase";

interface AuthContextValue {
  /** `null` once we know nobody is signed in; `undefined` while restoring. */
  session: Session | null;
  /** True until the persisted session has been read from secure storage. */
  initialising: boolean;
  /** Set when a magic-link deep link failed; cleared on the next attempt. */
  linkError: string | null;
  clearLinkError: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Where Supabase should send the user back to after a magic link. */
export function authRedirectUrl(): string {
  return Linking.createURL("/auth/callback");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initialising, setInitialising] = useState(true);
  const [linkError, setLinkError] = useState<string | null>(null);
  const handledUrl = useRef<string | null>(null);

  const incomingUrl = Linking.useURL();

  // Restore the persisted session, then track every subsequent auth change.
  useEffect(() => {
    let active = true;
    const supabase = getSupabase();

    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
      })
      .finally(() => {
        if (active) setInitialising(false);
      });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession);
      },
    );

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  // React Native throttles timers in the background, so gotrue's refresh loop
  // is driven from AppState rather than left running.
  useEffect(() => {
    const supabase = getSupabase();

    const apply = (status: AppStateStatus) => {
      if (status === "active") {
        void supabase.auth.startAutoRefresh();
      } else {
        void supabase.auth.stopAutoRefresh();
      }
    };

    apply(AppState.currentState);
    const listener = AppState.addEventListener("change", apply);
    return () => {
      listener.remove();
      void supabase.auth.stopAutoRefresh();
    };
  }, []);

  // Magic links land here: the app is opened with the callback URL.
  useEffect(() => {
    if (!incomingUrl || handledUrl.current === incomingUrl) return;
    const redirect = parseAuthRedirect(incomingUrl);
    if (!redirect) return;

    handledUrl.current = incomingUrl;
    const supabase = getSupabase();

    void (async () => {
      try {
        if (redirect.kind === "error") {
          setLinkError(redirect.message);
          return;
        }
        if (redirect.kind === "code") {
          const { error } = await supabase.auth.exchangeCodeForSession(
            redirect.code,
          );
          if (error) throw error;
        } else {
          const { error } = await supabase.auth.setSession({
            access_token: redirect.accessToken,
            refresh_token: redirect.refreshToken,
          });
          if (error) throw error;
        }
        setLinkError(null);
      } catch (error) {
        setLinkError(authErrorMessage(error));
      }
    })();
  }, [incomingUrl]);

  const clearLinkError = useCallback(() => setLinkError(null), []);

  const signOut = useCallback(async () => {
    await getSupabase().auth.signOut();
    setSession(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ session, initialising, linkError, clearLinkError, signOut }),
    [session, initialising, linkError, clearLinkError, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}
