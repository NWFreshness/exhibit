"use client";
import { useActionState } from "react";
import { submitRequest, submitPublicRequest, type RequestForm } from "@/app/actions/requests";

export function RequestFormFields({ districtName }: { districtName?: string }) {
  return (
    <>
      {districtName ? <p className="sans">Requesting for <b>{districtName}</b>. Short form — it does not ask for exhibit facts.</p> : null}
      <label>Tool name <input type="text" name="toolName" required maxLength={200} placeholder="e.g. Brisk Teaching" /></label>
      <label>Category <input type="text" name="category" defaultValue="General" maxLength={120} /></label>
      <label>Building <input type="text" name="building" maxLength={120} placeholder="e.g. Ridge Elementary" /></label>
      <label>Who would use it?
        <select name="intendedUse" defaultValue="staff_only">
          <option value="staff_only">Staff only</option>
          <option value="with_students">Students would use it</option>
        </select>
      </label>
      <label>Your name <input type="text" name="requesterName" maxLength={120} /></label>
      <label>Your school email <input type="email" name="requesterEmail" maxLength={160} /></label>
      <label>What do you want to use it for? <textarea name="note" rows={3} maxLength={2000} placeholder="A sentence or two. Never paste student work here." /></label>
    </>
  );
}

type State = { error?: string; toolId?: string; existing?: boolean; statusToken?: string } | null;

function StatusLink({ token }: { token: string }) {
  return (
    <div className="alert">Your private status link: <a href={`/request/status/${token}`}>check your request status</a>. Save it — this is the only time it is shown, and no email is sent.</div>
  );
}

export function AuthedRequestForm() {
  const [state, action] = useActionState<State, FormData>(async (_s, fd) => {
    const v = (k: string) => String(fd.get(k) || "");
    return submitRequest({
      toolName: v("toolName"), category: v("category") || "General", building: v("building"),
      intendedUse: v("intendedUse"), requesterName: v("requesterName"),
      requesterEmail: v("requesterEmail"), note: v("note"),
    } satisfies RequestForm);
  }, null);
  return (
    <form action={action} className="sans no-print">
      <h2>Request a tool</h2>
      <p className="hint sans">Heard about a tool in a building meeting? Send it to the council file instead of email. It lands on hold until reviewed.</p>
      <RequestFormFields />
      {state?.error && <div className="alert error">{state.error}</div>}
      {state && !state.error && state.statusToken && <StatusLink token={state.statusToken} />}
      {state && !state.error && (
        <div className="alert">{state.existing ? "That tool is already on file — you were added as another asker." : "Request received. It is on hold until the council reviews it."}</div>
      )}
      <button className="btn secondary" type="submit">Send request</button>
    </form>
  );
}

export function PublicRequestForm({ districtId, districtName }: { districtId: string; districtName: string }) {
  const [state, action] = useActionState<State, FormData>(async (_s, fd) => {
    const v = (k: string) => String(fd.get(k) || "");
    return submitPublicRequest(districtId, {
      toolName: v("toolName"), category: v("category") || "General", building: v("building"),
      intendedUse: v("intendedUse"), requesterName: v("requesterName"),
      requesterEmail: v("requesterEmail"), note: v("note"),
    } satisfies RequestForm);
  }, null);
  return (
    <form action={action} className="sans">
      <RequestFormFields districtName={districtName} />
      {state?.error && <div className="alert error">{state.error}</div>}
      {state && !state.error && state.statusToken && <StatusLink token={state.statusToken} />}
      {state && !state.error && (
        <div className="alert">{state.existing ? "That tool is already on file — you were added as another asker." : "Request received. The council reviews new requests before anything is approved."}</div>
      )}
      <button className="btn" type="submit">Send request</button>
    </form>
  );
}
