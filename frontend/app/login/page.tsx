import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "登录 · 贸客 AI",
  description: "进入贸客 AI 外贸业务工作台",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const query = await searchParams;
  const configError = query.error === "config";
  const loginError = query.error === "invalid";
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand"><span>贸</span><strong>贸客 AI</strong></div>
        <p className="section-kicker">SECURE WORKSPACE</p>
        <h1>登录外贸业务工作台</h1>
        <p className="login-copy">客户、订单、回款和自动化数据仅对授权运营人员开放。</p>
        <form action="/api/auth/login" method="post" className="login-form">
          <input type="hidden" name="next" value={query.next ?? "/"} />
          <label>
            访问密码
            <input name="password" type="password" autoComplete="current-password" required placeholder="请输入访问密码" />
          </label>
          {loginError && <p className="login-error">访问密码不正确，请重试。</p>}
          {configError && <p className="login-error">生产环境尚未配置访问凭据，请联系管理员。</p>}
          <button type="submit" disabled={configError}>安全登录</button>
        </form>
        <small>登录状态仅保存在当前浏览器，7 天后自动失效。</small>
      </section>
    </main>
  );
}
