"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Label } from "@/components/ui/input";
import { AGE_GROUP_TO_SCHOOL_YEAR, ageGroupSortKey } from "@/lib/waiting-list";

import { setAgeGroupAvailability, type WaitingListActionState } from "./actions";

export type AgeGroupSetting = {
  age_group: string;
  is_open: boolean;
  is_publicly_advertised: boolean;
};

const KNOWN_AGE_GROUPS = Object.keys(AGE_GROUP_TO_SCHOOL_YEAR).sort((a, b) =>
  ageGroupSortKey(a).localeCompare(ageGroupSortKey(b)),
);

/**
 * Open, close and advertise age groups. Club administrators only — the RLS
 * policy refuses anyone else, and the page does not render this at all unless
 * `is_club_admin()` said yes.
 *
 * "Open" is what the public form checks: a group that is not open is not
 * offered and `submit_waiting_list_entry()` refuses it outright.
 */
export function AgeGroupsPanel({ settings }: { settings: AgeGroupSetting[] }) {
  const [state, action, pending] = useActionState<WaitingListActionState, FormData>(
    setAgeGroupAvailability,
    {},
  );

  const configured = new Set(settings.map((s) => s.age_group));
  const unconfigured = KNOWN_AGE_GROUPS.filter((group) => !configured.has(group));

  return (
    <div className="space-y-4">
      {settings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No age groups are set up yet, so the public form shows the list as closed. Add one below.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Age group</th>
                <th className="py-2 pr-3 font-medium">Open for new entries</th>
                <th className="py-2 pr-3 font-medium">Advertised publicly</th>
                <th className="py-2 font-medium sr-only">Save</th>
              </tr>
            </thead>
            <tbody>
              {settings.map((setting) => (
                <tr key={setting.age_group} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-medium">{setting.age_group}</td>
                  <td className="py-2 pr-3">
                    <input
                      form={`ag-${setting.age_group}`}
                      type="checkbox"
                      name="is_open"
                      value="yes"
                      defaultChecked={setting.is_open}
                      className="h-4 w-4 accent-primary"
                      aria-label={`${setting.age_group} open for new entries`}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      form={`ag-${setting.age_group}`}
                      type="checkbox"
                      name="is_publicly_advertised"
                      value="yes"
                      defaultChecked={setting.is_publicly_advertised}
                      className="h-4 w-4 accent-primary"
                      aria-label={`${setting.age_group} advertised publicly`}
                    />
                  </td>
                  <td className="py-2">
                    <form id={`ag-${setting.age_group}`} action={action}>
                      <input type="hidden" name="age_group" value={setting.age_group} />
                      <Button type="submit" size="sm" variant="outline" disabled={pending}>
                        Save
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {unconfigured.length > 0 && (
        <form action={action} className="flex flex-wrap items-end gap-2 border-t pt-4">
          <div className="min-w-40 space-y-1">
            <Label htmlFor="new-age-group">Add an age group</Label>
            <Select id="new-age-group" name="age_group" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {unconfigured.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="is_open"
              value="yes"
              defaultChecked
              className="h-4 w-4 accent-primary"
            />
            Open
          </label>
          <label className="flex h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="is_publicly_advertised"
              value="yes"
              className="h-4 w-4 accent-primary"
            />
            Advertised
          </label>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Add"}
          </Button>
        </form>
      )}

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.notice && <p className="text-sm text-muted-foreground">{state.notice}</p>}
    </div>
  );
}
