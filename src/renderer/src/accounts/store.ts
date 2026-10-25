import { create } from "zustand";
import type { AccountService, AccountStatus } from "@shared/types";

// Spotify, YouTube Music and Apple Music accounts, as the main process reports them.

interface AccountsStore {
  accounts: AccountStatus[];
  init(): void;
}

let initialized = false;

export const useAccounts = create<AccountsStore>((set) => ({
  accounts: [],
  init() {
    if (initialized) return;
    initialized = true;
    window.encore.accounts.onChange((accounts) => set({ accounts }));
    void window.encore.accounts.list().then((accounts) => set({ accounts }));
  },
}));

export const useAccount = (service: AccountService) => useAccounts((s) => s.accounts.find((a) => a.service === service));
