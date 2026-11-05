import { useState, type FormEvent } from "react";
import { Notice } from "../components/ui";
import { supabase } from "../lib/supabase";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return setError("Не настроено подключение к Supabase.");
    setBusy(true);
    setError("");
    const { error: loginError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (loginError) setError(loginError.message);
    setBusy(false);
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand login-brand">
          <span className="brand-mark">С</span>
          <span>
            Стройка<span className="brand-light"> / задачи</span>
          </span>
        </div>
        <h1>Вход в систему</h1>
        {error && <Notice bad>{error}</Notice>}
        <form onSubmit={submit} className="form-stack">
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Пароль
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="button primary full" disabled={busy}>
            {busy ? "Входим…" : "Войти"}
          </button>
        </form>
      </section>
    </main>
  );
}
