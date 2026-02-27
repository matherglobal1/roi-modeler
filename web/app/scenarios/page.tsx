import styles from "../simple-page.module.css";

export default function ScenariosPage() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.kicker}>Workspace</p>
        <h1 className={styles.title}>Scenarios</h1>
        <p className={styles.body}>
          Scenario management will be expanded in a dedicated pass. This route is active now so navigation feels
          complete in the redesigned shell.
        </p>
      </section>
    </main>
  );
}
