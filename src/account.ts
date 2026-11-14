import {
  acceptFriend, createProfile, fetchMaps, fetchRelationships, getSession, removeFriend,
  requestFriend, signIn, signOut, signUp, watchSession,
} from "./sync";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export async function setupAccount(onReady: (id: string, username: string) => Promise<void>, onChange: () => void): Promise<void> {
  $("account").hidden = false;
  const status = $("account-status");
  const session = await getSession();
  watchSession(session?.user.id ?? null);
  const authForm = $<HTMLFormElement>("auth-form");
  const signedIn = $("account-signed-in");

  async function run(action: () => Promise<void>) {
    status.textContent = "";
    try {
      await action();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  const email = () => $<HTMLInputElement>("auth-email").value.trim();
  const password = () => $<HTMLInputElement>("auth-password").value;
  authForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void run(async () => { await signIn(email(), password()); window.location.reload(); });
  });
  $("sign-up").addEventListener("click", () => void run(async () => {
    if (!authForm.reportValidity()) return;
    if (await signUp(email(), password())) window.location.reload();
    else status.textContent = "Check your email to confirm your account, then sign in.";
  }));
  $("sign-out").addEventListener("click", () => void run(async () => {
    await signOut();
    window.location.reload();
  }));

  authForm.hidden = Boolean(session);
  signedIn.hidden = !session;
  if (!session) {
    status.textContent = "Sign in to import and share your map.";
    return;
  }

  $("account-name").textContent = session.user.email ?? "Signed in";
  const maps = await fetchMaps();
  const own = maps.find((map) => map.id === session.user.id);
  const profileForm = $<HTMLFormElement>("profile-form");
  profileForm.hidden = Boolean(own);
  profileForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void run(async () => {
      await createProfile($<HTMLInputElement>("profile-name").value);
      window.location.reload();
    });
  });
  if (!own) return;

  $("account-name").textContent = `${own.username} (${session.user.email ?? "signed in"})`;
  $("friends-panel").hidden = false;

  async function loadFriends() {
    const relationships = await fetchRelationships();
    const list = $("friends-list");
    list.replaceChildren();
    for (const relationship of relationships) {
      const row = document.createElement("div");
      row.className = "friend-row";
      const label = document.createElement("span");
      label.textContent = `${relationship.username} · ${relationship.status}`;
      row.append(label);
      if (relationship.status === "incoming") {
        const accept = document.createElement("button");
        accept.textContent = "Accept";
        accept.addEventListener("click", () => void run(async () => {
          await acceptFriend(relationship.id);
          onChange();
          await loadFriends();
        }));
        row.append(accept);
      }
      const remove = document.createElement("button");
      remove.textContent = relationship.status === "friend" ? "Remove" : "Cancel";
      remove.addEventListener("click", () => void run(async () => {
        await removeFriend(relationship.id);
        onChange();
        await loadFriends();
      }));
      row.append(remove);
      list.append(row);
    }
  }

  $<HTMLFormElement>("friend-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void run(async () => {
      const input = $<HTMLInputElement>("friend-name");
      await requestFriend(input.value.trim());
      input.value = "";
      await loadFriends();
    });
  });
  await loadFriends();
  await onReady(session.user.id, own.username);
  const update = () => void run(loadFriends);
  window.addEventListener("focus", update);
  window.setInterval(update, 30000);
}
