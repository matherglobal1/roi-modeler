import styles from "../simple-page.module.css";

export default function SettingsPage() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.kicker}>Workspace</p>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.body}>
          This page is intentionally minimal for now and reserved for environment, integration, and access controls in
          later iterations.
        </p>
      </section>
    </main>
  );
}
