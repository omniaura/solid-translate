import { createSignal, Errored, Loading } from "solid-js";
import { render } from "@solidjs/web";
import { TranslationProvider, T, Var, Num, Plural, LocaleSelector } from "../../dist/index.js";
import translations from "virtual:solid-translate/lazy";

function Page() {
  const [name, setName] = createSignal("Alice");
  return <main style={{ "font-family": "system-ui", "max-width": "640px", margin: "64px auto", padding: "24px" }}>
    <h1><T>Hello world</T></h1>
    <p><T>Hello <Var>{name()}</Var>, welcome!</T></p>
    <p><Plural n={3} one="One item" other="Many items" /></p>
    <p><Num>{1234567.89}</Num></p>
    <label>Language: <LocaleSelector labels={{ en: "English", es: "Español" }} /></label>
    <p><button onClick={() => { setName("Bob"); }}>Change name</button></p>
  </main>;
}

render(() => <Errored fallback={(error) => <pre>{String(error)}</pre>}>
  <Loading fallback={<p>Loading…</p>}>
    <TranslationProvider locale="en" translations={translations}>
      <Page />
    </TranslationProvider>
  </Loading>
</Errored>, document.getElementById("app")!);
