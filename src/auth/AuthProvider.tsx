import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { Profile } from "../lib/database";

type AuthState = {
  ready: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  profileLoading: boolean;
  error: string;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  ready: false,
  session: null,
  user: null,
  profile: null,
  profileLoading: false,
  error: "",
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authError, setAuthError] = useState("");
  const [profileResult, setProfileResult] = useState<{
    userId: string | null;
    profile: Profile | null;
    error: string;
  }>({ userId: null, profile: null, error: "" });
  const user = session?.user ?? null;
  const profileLoading = Boolean(user && profileResult.userId !== user.id);
  const profile =
    user && profileResult.userId === user.id ? profileResult.profile : null;
  const error =
    user && profileResult.userId === user.id ? profileResult.error : authError;

  useEffect(() => {
    if (!supabase) {
      setReady(true);
      setAuthError(
        "Добавьте VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY в окружение.",
      );
      return;
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !supabase) {
      setProfileResult({ userId: null, profile: null, error: "" });
      return;
    }

    let active = true;
    setProfileResult({ userId: user.id, profile: null, error: "" });
    void (async () => {
      try {
        const { data, error: queryError } = await supabase
          .from("profiles")
          .select("id,display_name,role")
          .eq("id", user.id)
          .maybeSingle();
        if (!active) return;
        setProfileResult({
          userId: user.id,
          profile: data,
          error:
            queryError?.message ??
            (!data ? "Для пользователя не настроен профиль." : ""),
        });
      } catch (reason) {
        if (!active) return;
        setProfileResult({
          userId: user.id,
          profile: null,
          error: reason instanceof Error ? reason.message : String(reason),
        });
      }
    })();

    return () => {
      active = false;
    };
  }, [user?.id]);

  return (
    <AuthContext.Provider
      value={{
        ready,
        session,
        user,
        profile,
        profileLoading,
        error,
        signOut: async () => {
          await supabase?.auth.signOut({ scope: "local" });
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
