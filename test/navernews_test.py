# 단순 크롤링 테스트 코드입니다
from flask import Flask
import requests

app = Flask(__name__)

CLIENT_ID = "수정 : 개인 ID 입력"
CLIENT_SECRET = "수정 : 개인 코드 입력"

# 브라우저에서 http://localhost:5000/ 접속하면 이 함수가 실행됨
@app.route("/")
def index():
    url = "https://openapi.naver.com/v1/search/news.json"
    headers = {
        "X-Naver-Client-Id": CLIENT_ID,
        "X-Naver-Client-Secret": CLIENT_SECRET
    }
    params = {"query": '"서울교통공사"', "display": 100, "sort": "date"}

    response = requests.get(url, headers=headers, params=params)
    data = response.json()

    # 웹페이지에 보여줄 HTML을 문자열로 만들기
    html = "<h1>네이버 뉴스 크롤링 결과</h1>"
    for item in data["items"]:
        html += f"""
        <div style="border:1px solid #ccc; margin:10px; padding:10px;">
            <a href="{item['link']}" target="_blank">{item['title']}</a>
            <p>{item['description']}</p>
            <small>{item['pubDate']}</small>
        </div>
        """
    return html

# 웹 서버 실행
if __name__ == "__main__":
    app.run(debug=True)
