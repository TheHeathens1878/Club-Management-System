"use client";

/**
 * Town and county, together, because one decides the other.
 *
 * Adam, 2026-08-25: "Whenever someone types Sale in town or city, I want you
 * auto-complete the County to Greater Manchester and not let them change it"
 * — and the same for Timperley, Altrincham and the rest of Trafford.
 *
 * Typing a town the club knows fills the county in and makes it read-only,
 * with a line saying why. Typing anything else hands the field straight back:
 * a family in Leeds types their own county and nobody argues with them.
 *
 * READ-ONLY, NOT DISABLED. A disabled input is not submitted, and the county
 * would quietly vanish from the address on every save. Read-only still posts
 * its value, which is the whole point of settling it.
 */

import { useEffect, useState } from "react";

import { Input, Label } from "@/components/ui/input";
import { countyForTown } from "@/lib/address";

export function TownCountyFields({
  idPrefix,
  townName = "address_town",
  countyName = "address_county",
  defaultTown = "",
  defaultCounty = "",
  required = false,
}: {
  /** Unique per form on the page, so the labels point at the right inputs. */
  idPrefix: string;
  townName?: string;
  countyName?: string;
  defaultTown?: string;
  defaultCounty?: string;
  required?: boolean;
}) {
  const [town, setTown] = useState(defaultTown);
  const [county, setCounty] = useState(defaultCounty);

  const settled = countyForTown(town);

  // The town is the authority while it names a place the club knows. Typing
  // "Sale" over "Leeds" replaces whatever county was there; deleting the town
  // again leaves what was settled, rather than blanking a field somebody may
  // have meant.
  useEffect(() => {
    if (settled && settled !== county) setCounty(settled);
    // `county` is deliberately not a dependency: this runs when the TOWN
    // changes, and re-running it on every keystroke in the county box would
    // fight a person typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);

  return (
    <>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-town`}>Town or city</Label>
        <Input
          id={`${idPrefix}-town`}
          name={townName}
          value={town}
          onChange={(event) => setTown(event.target.value)}
          required={required}
          autoComplete="address-level2"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-county`}>County</Label>
        <Input
          id={`${idPrefix}-county`}
          name={countyName}
          value={county}
          onChange={(event) => setCounty(event.target.value)}
          readOnly={!!settled}
          aria-readonly={!!settled}
          autoComplete="address-level1"
          className={settled ? "bg-muted text-muted-foreground" : undefined}
        />
        {settled ? (
          <p className="text-xs text-muted-foreground">
            {town.trim()} is in {settled} — set for you, and not editable.
          </p>
        ) : null}
      </div>
    </>
  );
}
