⚠️ **DISCLAIMER**: This project is for **educational purposes only**.  
Do not use for mass downloading or commercial use.  
Respect website `robots.txt` and terms of service.

## Endpoints

- `GET /` → Welcome message
- `GET /api/chapters/<manga_slug>?start=1&end=10`
- `POST /api/chapter/images` → `{ "chapter_link": "..." }`
- `POST /api/download` → `{ "manga_name": "...", "chapter_link": "..." }`
- `GET /api/download/status/<job_id>`
- `GET /download?path=...` → Download generated PDF

## Deployed on Render with Docker

Built for learning:
- Docker deployment
- Selenium scraping
- Flask API design
- Background processing
