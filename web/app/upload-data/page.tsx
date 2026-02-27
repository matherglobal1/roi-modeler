import styles from "../simple-page.module.css";

export default function UploadDataPage() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.kicker}>Next Step</p>
        <h1 className={styles.title}>Upload Data</h1>
        <p className={styles.body}>
          This section is now wired in the navigation and ready for the upload workflow implementation. In the next
          pass, this page will support drag-and-drop uploads, preview verification, and model execution.
        </p>
      </section>
    </main>
  );
}
