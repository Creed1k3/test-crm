import {
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { LoginPage } from "./auth/LoginPage";
import { initials, Loading, Notice } from "./components/ui";
import { ObjectsPage } from "./features/objects/ObjectsPage";
import { ObjectPage } from "./features/objects/ObjectPage";
import { MyTasksPage, TaskPage } from "./features/tasks/TasksPage";

export default function App() {
  const { ready, user, profile, profileLoading, error, signOut } = useAuth();
  if (!ready || (user && profileLoading)) return <Loading />;
  if (!user)
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  if (!profile)
    return (
      <main className="center-page">
        <div className="profile-error">
          <Notice bad>{error || "Профиль не найден."}</Notice>
          <button className="button secondary" onClick={() => void signOut()}>
            Выйти
          </button>
        </div>
      </main>
    );

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route
          index
          element={
            <Navigate
              to={profile.role === "performer" ? "/my-tasks" : "/objects"}
              replace
            />
          }
        />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/objects" element={<ObjectsPage />} />
        <Route path="/objects/:id" element={<ObjectPage />} />
        <Route path="/tasks/:id" element={<TaskPage />} />
        <Route
          path="/my-tasks"
          element={
            profile.role === "performer" ? (
              <MyTasksPage />
            ) : (
              <Navigate to="/objects" replace />
            )
          }
        />
        <Route
          path="*"
          element={
            <main className="content">
              <h1>Страница не найдена</h1>
              <Link to="/">На главную</Link>
            </main>
          }
        />
      </Route>
    </Routes>
  );
}

function Shell() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">С</span>
          <span>
            Стройка<span className="brand-light"> / задачи</span>
          </span>
        </Link>
        <nav aria-label="Основная навигация">
          <Link to="/objects">Объекты</Link>
          {profile?.role === "performer" && (
            <Link to="/my-tasks">Мои задачи</Link>
          )}
        </nav>
        <div className="account">
          <span className="avatar">
            {initials(profile?.display_name || "")}
          </span>
          <span className="account-name">{profile?.display_name}</span>
          <button
            className="button quiet"
            onClick={async () => {
              await signOut();
              navigate("/login");
            }}
          >
            Выйти
          </button>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
