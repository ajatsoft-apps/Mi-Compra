create index lidl_offer_observations_snapshot_household_fk_idx
  on public.lidl_offer_observations (snapshot_id, household_id);
