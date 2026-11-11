"""Generate fake, clearly-marked sample documents for demos and tests. Never use real IDs."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent / "fake-docs")
OUT.mkdir(parents=True, exist_ok=True)
F = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def page(name, title, lines, size=(1100, 1400), bg="white"):
    im = Image.new("RGB", size, bg)
    d = ImageDraw.Draw(im)
    d.text((60, 50), title, font=ImageFont.truetype(FB, 38), fill="black")
    y = 130
    for ln in lines:
        bold = ln.startswith("**")
        txt = ln.strip("*")
        d.text((60, y), txt, font=ImageFont.truetype(FB if bold else F, 26), fill="black")
        y += 44 if txt else 22
    d.text((size[0] - 470, size[1] - 70), "SPECIMEN - FAKE FOR DEMO", font=ImageFont.truetype(FB, 30), fill=(200, 0, 0))
    im.save(OUT / name, quality=90)
    print(OUT / name)


page("passport.jpg", "PASAPORTE / PASSPORT", [
    "ESTADOS UNIDOS MEXICANOS",
    "",
    "Apellidos / Surname: LOPEZ RAMIREZ",
    "Nombres / Given names: MARIA GUADALUPE",
    "Nacionalidad / Nationality: MEXICANA",
    "Fecha de nacimiento / Date of birth: 12 04 1990",
    "Lugar de nacimiento / Place of birth: OAXACA, MEXICO",
    "Fecha de expedicion / Date of issue: 15 03 2018",
    "Fecha de caducidad / Date of expiry: 15 03 2024",
    "Pasaporte No.: G00000000",
], size=(1200, 800), bg=(235, 240, 230))

page("notice-to-appear.jpg", "U.S. Department of Homeland Security", [
    "**Notice to Appear (Form I-862)",
    "In removal proceedings under section 240 of the Immigration and Nationality Act",
    "Subject ID / File No: A 212-345-678",
    "Date: September 20, 2025",
    "In the Matter of: MARIA LOPES RAMIREZ",
    "Date of birth: 04/12/1990",
    "",
    "You are an arriving alien / You are an alien present in the United States",
    "who has not been admitted or paroled.",
    "**The Department of Homeland Security alleges that:",
    "1. You are not a citizen or national of the United States;",
    "2. You are a native of Mexico and a citizen of Mexico;",
    "3. You arrived in the United States at or near Nogales, Arizona,",
    "   on or about June 3, 2019;",
    "4. You were not then admitted or paroled after inspection.",
    "**On the basis of the foregoing, it is charged that you are subject to removal",
    "**pursuant to the following provision(s) of law:",
    "Section 212(a)(6)(A)(i) of the Immigration and Nationality Act, as amended,",
    "in that you are an alien present in the United States without being admitted",
    "or paroled.",
    "",
    "YOU ARE ORDERED to appear before an immigration judge at:",
    "26 Federal Plaza, 12th Floor, New York, NY 10278",
    "on a date and time to be set.",
])

page("hearing-notice.jpg", "Executive Office for Immigration Review", [
    "**Immigration Court, New York - Broadway",
    "**NOTICE OF IN-PERSON HEARING IN REMOVAL PROCEEDINGS",
    "",
    "Respondent: LOPEZ RAMIREZ, MARIA",
    "A-Number: 212-345-678",
    "",
    "Your case has been scheduled for a MASTER hearing before",
    "the Immigration Judge on:",
    "",
    "**Tuesday, December 8, 2026 at 8:30 AM",
    "",
    "Location: 290 Broadway, 4th Floor, New York, NY 10007",
    "",
    "Failure to appear at your hearing except for exceptional",
    "circumstances may result in one or more of the following actions:",
    "(1) You may be taken into custody by DHS. (2) The judge may",
    "order you removed in your absence.",
    "Date of notice: October 2, 2026",
], size=(1100, 1100))

page("pay-stub.jpg", "Sunrise Bakery LLC - Earnings Statement", [
    "Employee: Maria G. Lopez",
    "Address: 410 W 145th St, Apt 3, New York, NY 10031",
    "Pay period: 03/01/2021 - 03/14/2021",
    "Pay date: 03/19/2021",
    "",
    "Gross pay: $1,120.00",
    "Net pay: $952.40",
], size=(1100, 700), bg=(250, 248, 240))
