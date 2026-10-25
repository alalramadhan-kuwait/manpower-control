-- Engineer links (login ID + key, no app login) are no longer used (Section Head, 25 Oct 2026): every link is turned
-- off. The rows stay (who had a link, when it was made, last seen) and everything entered through them keeps its name
-- in the history. Engineers sign in with their own login.
update public.trk_access set active = false where active;
