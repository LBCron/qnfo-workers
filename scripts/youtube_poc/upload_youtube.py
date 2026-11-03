#!/usr/bin/env python3
"""Upload short.mp4 + captions + metadata.json with the YouTube Data API v3 (videos.insert, resumable).

  python -I upload_youtube.py <out-dir> [--client client_secret.json] [--token token.json] [--public]

First run opens a browser for the channel owner's Google consent (scope youtube.upload); the token is stored next to --token
(keep it out of git). Uploads as private unless --public. Quota: videos.insert costs 1600 units of the 10000 daily default.
Unverified API projects can only upload private videos until the project passes the YouTube API audit.
"""
import argparse, json, sys
from pathlib import Path

SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]


def privacy_status(public=False):
    return "public" if public else "private"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("outdir"); ap.add_argument("--client", default="client_secret.json")
    ap.add_argument("--token", default="youtube_token.json"); ap.add_argument("--public", action="store_true"); ap.add_argument("--no-browser", action="store_true")
    a = ap.parse_args()
    d = Path(a.outdir); meta = json.loads((d / "metadata.json").read_text("utf8")); video = d / "short.mp4"
    if not Path(a.client).exists():
        sys.exit(f"missing {a.client}: create an OAuth client (Desktop app) in Google Cloud, enable YouTube Data API v3, download the JSON")
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload
    cred = Credentials.from_authorized_user_file(a.token, SCOPES) if Path(a.token).exists() else None
    if not cred or not cred.valid:
        if cred and cred.expired and cred.refresh_token:
            cred.refresh(Request())
        else:
            cred = InstalledAppFlow.from_client_secrets_file(a.client, SCOPES).run_local_server(port=8765 if a.no_browser else 0, open_browser=not a.no_browser, authorization_prompt_message="OPEN: {url}")
        Path(a.token).write_text(cred.to_json())
    yt = build("youtube", "v3", credentials=cred)
    body = {"snippet": {"title": meta["title"], "description": meta["description"], "tags": meta["tags"], "categoryId": meta["categoryId"]},
            "status": {"privacyStatus": privacy_status(a.public), "selfDeclaredMadeForKids": meta["madeForKids"],
                       "containsSyntheticMedia": meta["containsSyntheticMedia"]}}
    req = yt.videos().insert(part="snippet,status", body=body, media_body=MediaFileUpload(str(video), chunksize=-1, resumable=True))
    resp = None
    while resp is None:
        st, resp = req.next_chunk()
        if st: print(f"{int(st.progress()*100)}%")
    print("uploaded", resp["id"], f"https://youtube.com/shorts/{resp['id']}", resp["status"]["privacyStatus"])


if __name__ == "__main__":
    main()
