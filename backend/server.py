from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
import threading
import os
import requests
import time
import re
import img2pdf
import shutil
from bs4 import BeautifulSoup

# --- Selenium Imports ---
from selenium import webdriver
from selenium.webdriver.chrome.service import Service as ChromeService
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options

app = Flask(__name__)
CORS(app)

# Simple in-memory job tracker
download_jobs = {}

# ======================
# SCRAPING FUNCTIONS
# ======================

def getChapters(manga_name, Ch_Start, Ch_End):
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--disable-software-rasterizer")
    options.add_argument("--disable-extensions")
    options.add_argument("--remote-debugging-port=9222")
    options.add_argument("--disable-images")
    options.add_argument("--disable-javascript")  # Optional: speeds up if JS not needed

    # 👇 Point to Chromium binary installed via Docker
    options.binary_location = "/usr/bin/chromium"

    # 👇 Use system chromedriver
    service = ChromeService(executable_path="/usr/bin/chromedriver")
    driver = webdriver.Chrome(service=service, options=options)

    try:
        url = f'https://www.mangaread.org/manga/{manga_name}/'
        driver.get(url)
        time.sleep(5)  # Wait for JS to load (if not disabled)

        # Try to click "Show More" if exists
        try:
            show_more_button = driver.find_element(By.CLASS_NAME, 'chapter-readmore')
            show_more_button.click()
            time.sleep(2)
        except:
            pass  # Ignore if button not found

        soup = BeautifulSoup(driver.page_source, 'html.parser')
        chapters = soup.find_all('li', class_='wp-manga-chapter')
        chapter_links = []

        for chapter in chapters:
            a_tag = chapter.find('a')
            if not a_tag or not a_tag.has_attr('href'):
                continue
            ch_link = a_tag['href']
            nums = re.findall(r'\d+', ch_link)
            if not nums:
                continue
            nums = int(nums[0])
            if Ch_Start <= nums <= Ch_End:
                chapter_links.append(ch_link)

        chapter_links.reverse()
        return chapter_links

    except Exception as e:
        print(f"[getChapters ERROR] {str(e)}")
        raise e
    finally:
        driver.quit()


def scrape_img(ch_link):
    try:
        response = requests.get(ch_link, timeout=10)
        if response.status_code != 200:
            return []
        soup = BeautifulSoup(response.text, 'lxml')
        images = soup.find_all('img', class_='wp-manga-chapter-img')
        img_urls = [img['src'].strip() for img in images if img.get('src') and img['src'].strip()]
        return img_urls
    except Exception as e:
        print(f"[scrape_img ERROR] {str(e)}")
        return []


def download_images(image_urls, manga_name, ch_link, base_dir):
    try:
        chFolder = f'Chapter-{ch_link.split("chapter-")[1].split("/")[0]}'
        manga_directory = os.path.join(base_dir, manga_name)
        directory_path = os.path.join(manga_directory, chFolder)

        os.makedirs(directory_path, exist_ok=True)

        for i, url in enumerate(image_urls):
            try:
                response = requests.get(url, timeout=10)
                if response.status_code == 200:
                    # Use .jpg for consistency
                    image_path = os.path.join(directory_path, f'{manga_name}_{chFolder}_pg{i+1}.jpg')
                    if not os.path.exists(image_path):
                        with open(image_path, 'wb') as f:
                            f.write(response.content)
            except Exception as e:
                print(f"Failed to download {url}: {e}")
                continue

        print(f"Downloaded {chFolder}")
    except Exception as e:
        print(f"[download_images ERROR] {str(e)}")


def convertPDF(mangaDirectory):
    try:
        chaptersList = os.listdir(mangaDirectory)

        for chapter in chaptersList:
            chapter_path = os.path.join(mangaDirectory, chapter)
            if not os.path.isdir(chapter_path):
                continue

            pdf_path = os.path.join(mangaDirectory, f'{chapter}.pdf')
            if os.path.exists(pdf_path):
                continue

            imgsList = [
                os.path.join(chapter_path, img)
                for img in os.listdir(chapter_path)
                if img.lower().endswith(('.png', '.jpg', '.jpeg'))
            ]

            if not imgsList:
                continue

            # Sort by page number
            def sort_key(path):
                match = re.findall(r'\d+', path.split('_pg')[-1])
                return int(match[0]) if match else 0

            imgsList.sort(key=sort_key)

            try:
                with open(pdf_path, 'wb') as f:
                    f.write(img2pdf.convert(imgsList))
                shutil.rmtree(chapter_path)
                print(f'Converted {chapter} to PDF')
            except Exception as e:
                print(f"PDF conversion failed for {chapter}: {e}")

    except Exception as e:
        print(f"[convertPDF ERROR] {str(e)}")


# ======================
# API ENDPOINTS
# ======================

@app.route('/')
def home():
    return jsonify({
        "message": "MangaStream API - Educational Use Only",
        "endpoints": {
            "chapters": "GET /api/chapters/<manga_slug>?start=1&end=10",
            "images": "POST /api/chapter/images { chapter_link: '...' }",
            "download": "POST /api/download { manga_name: '...', chapter_link: '...' }",
            "status": "GET /api/download/status/<job_id>",
            "file": "GET /download?path=..."
        }
    })


@app.route('/api/chapters/<manga_name>', methods=['GET'])
def api_get_chapters(manga_name):
    try:
        start = int(request.args.get('start', 1))
        end = int(request.args.get('end', 10))
        links = getChapters(manga_name, start, end)
        return jsonify({"success": True, "chapters": links})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/chapter/images', methods=['POST'])
def api_scrape_images():
    data = request.json
    ch_link = data.get('chapter_link')
    if not ch_link:
        return jsonify({"success": False, "error": "chapter_link required"}), 400
    try:
        img_urls = scrape_img(ch_link)
        return jsonify({"success": True, "images": img_urls})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/download', methods=['POST'])
def api_download_chapter():
    data = request.json
    manga_name = data.get('manga_name')
    ch_link = data.get('chapter_link')

    if not manga_name or not ch_link:
        return jsonify({"success": False, "error": "manga_name and chapter_link required"}), 400

    job_id = f"{manga_name}_{hash(ch_link)}"
    download_jobs[job_id] = "started"

    def background_task():
        try:
            base_dir = "/tmp/mangas"
            os.makedirs(base_dir, exist_ok=True)

            # Scrape images
            img_urls = scrape_img(ch_link)
            if not img_urls:
                download_jobs[job_id] = "failed|No images found"
                return

            # Download images
            download_images(img_urls, manga_name, ch_link, base_dir)

            # Convert to PDF
            manga_dir = os.path.join(base_dir, manga_name)
            convertPDF(manga_dir)

            # Check if PDF was created
            ch_num = ch_link.split("chapter-")[1].split("/")[0]
            pdf_filename = f"Chapter-{ch_num}.pdf"
            pdf_path = os.path.join(manga_dir, pdf_filename)

            if os.path.exists(pdf_path):
                download_jobs[job_id] = f"done|{pdf_path}"
            else:
                download_jobs[job_id] = "failed|PDF not generated"

        except Exception as e:
            download_jobs[job_id] = f"failed|{str(e)}"

    thread = threading.Thread(target=background_task)
    thread.start()

    return jsonify({
        "success": True,
        "job_id": job_id,
        "status_url": f"/api/download/status/{job_id}",
        "message": "Download and PDF conversion started in background."
    })


@app.route('/api/download/status/<job_id>', methods=['GET'])
def api_download_status(job_id):
    status = download_jobs.get(job_id, "not_found")
    if status.startswith("done|"):
        pdf_path = status.split("|", 1)[1]
        return jsonify({
            "status": "done",
            "pdf_url": f"/download?path={pdf_path}"
        })
    elif status.startswith("failed|"):
        reason = status.split("|", 1)[1]
        return jsonify({
            "status": "failed",
            "reason": reason
        })
    else:
        return jsonify({"status": status})


@app.route('/download', methods=['GET'])
def download_file():
    file_path = request.args.get('path')
    if not file_path or not os.path.exists(file_path):
        return "File not found or expired.", 404
    filename = os.path.basename(file_path)
    return send_file(file_path, as_attachment=True, download_name=filename)


# ======================
# RUN SERVER
# ======================

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 10000))
    app.run(host='0.0.0.0', port=port)
