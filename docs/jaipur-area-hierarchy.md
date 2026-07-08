# Jaipur Rental Area Hierarchy (research)

Basis for the neighbourhood restructure (major area → sub-area). Researched against
99acres, MagicBricks, NoBroker, Housing.com, mapsofindia, JNN/JDA zone data.

## Key finding
None of the big portals use a strict two-level zone→locality tree. They use a **flat
locality list** plus a curated **"Popular/Top localities"** subset. The two-level rollup
is something we impose. Portals' consistent "top localities" for Jaipur:
**Mansarovar, Vaishali Nagar, Malviya Nagar, Tonk Road, Jagatpura, Ajmer Road** (+ Pratap Nagar for value).
The only formal two-level "Zone" structure is municipal (JNN "Mansarovar Zone", "Malviya Nagar Zone").

## Major areas (16) → sub-areas
1. **Mansarovar** (SW) — Shipra Path, Kiran Path, Madhyam Marg, Barh Devariya, ISKCON Road, Mahima Nagar, Radha Nikunj, Ramnagar, Vivek Vihar, New Sanganer Road, Shanti Path
2. **Vaishali Nagar** (W/NW) — Amrapali Marg, Central Spine, Gandhi Path (W), Chitrakoot, Hanuman Nagar, Queens Road, Vaishali Nagar Extn, Khatipura
3. **Malviya Nagar** (S) — Sectors 1–11, Girdhar Marg, Model Town, Sunder Nagar, Jawahar Circle, World Trade Park (WTP), Gaurav Tower, Bajaj Nagar
4. **C-Scheme / Ashok Nagar** (central) — Ashok Nagar, Panch Batti, Bhagwan Das Road, Sardar Patel Marg, MI Road, Moti Doongri / Birla Mandir
5. **Jagatpura** (SE) — Mahal Road, Balaji Towers, Goverdhanpura, Gokulpura, Vidhani, Model Town (Jagatpura), Siddharth Nagar (Jagatpura)
6. **Vidhyadhar Nagar** (N) — Sectors 1–10, Central Spine (N), Kunj Vihar, Jai Ambey Nagar, Stadium
7. **Raja Park** (E) — Adarsh Nagar, Gangotri, Tilak Nagar, Devi Nagar, Moti Nagar, Gopinath Marg
8. **Tonk Road** (S corridor) — Tonk Phatak, Barkat Nagar, Durgapura, Gopalpura Bypass, Mahaveer Nagar, Riddhi Siddhi, B2 Bypass
9. **Jhotwara** (NW) — Kalwar Road, Niwaru Road, Khatipura, Bindayaka, Govindpura, Panchyawala, Sirsi Road
10. **Bani Park** (central-N) — Collectorate Circle, Kabir Marg, Station Road, Sindhi Camp, Shastri Nagar
11. **Sodala / Ajmer Road** (W corridor) — Shyam Nagar, Nirman Nagar, Saraswati Nagar, Hasanpura, Kamla Nehru Nagar, DCM, 200-ft Bypass
12. **Gopalpura / Gopal Pura** (S) — Gopalpura Bypass, Gopal Nagar, Triveni Nagar, Shanti Nagar, Surya Nagar
13. **Durgapura** (S) — Maharani Farm, Mahaveer Nagar, Muktanand Nagar, Yashwant Nagar, Shanti Nagar
14. **Pratap Nagar** (S/Sanganer) — Sectors 1–30, Housing Board, Sanganer
15. **Sitapura** (SE) — *INDUSTRIAL* — Sitapura Industrial Area (RIICO), Gems & Jewellery Park
16. **Civil Lines** (central-W) — Sahkar Marg, Kanti Chandra Road, Hathroi

## Existing tags → major area (for rollup migration)
| Existing tag | Major area | Type |
|---|---|---|
| Mansarovar | Mansarovar | Residential (area itself) |
| Maharani Farm | Durgapura | Residential |
| Iskon Temple | Mansarovar | Landmark |
| Hayat Mansarovar | Mansarovar | Residential |
| Model Town | Malviya Nagar | Residential (also a Jagatpura one — disambiguate) |
| Barkat Nagar | Tonk Road (Tonk Phatak) | Residential |
| Balaji Tower | Jagatpura | Residential |
| WTP | Malviya Nagar | Landmark (mall) |
| Girdhar Marg | Malviya Nagar | Residential |
| Shyam Nagar | Sodala / Ajmer Road | Residential |
| EHCC Hospital | Malviya Nagar (Jawahar Circle) | Landmark |
| Saraswati Nagar | Sodala / Ajmer Road | Residential (ambiguous — verify pincode) |
| Mansarovar D Mart | Mansarovar | Landmark |
| Bharat Mata Circle | Mansarovar | Landmark |
| Gopal Pura | Gopalpura | Residential+Commercial (area itself) |
| Birla Mandir | C-Scheme (Moti Doongri) | Landmark |
| Nirman Nagar | Sodala / Ajmer Road | Residential |
| Bajaj Nagar | Malviya Nagar (JLN Marg) | Residential |
| Siddharth Nagar | Jagatpura | Residential (ambiguous — verify pincode) |
| Gulab Garh | Mansarovar | Landmark |
| Mahaveer Nagar | Durgapura | Residential |
| Sitapura Industrial Area | Sitapura | **Industrial** |
| Arambhkala Foundation | (unresolved — likely Mansarovar) | Landmark |

## To resolve from listing pincodes
- **Siddharth Nagar** and **Saraswati Nagar** — multiple same-named localities.
- **Arambhkala Foundation** — no reliable public geocode.

## Commercial / industrial flags
- Industrial: Sitapura Industrial Area (RIICO). (Others if they appear: Jhotwara Ind. Area, VKI, Sudarshanpura, Transport Nagar.)
- Commercial hubs: C-Scheme/MI Road, WTP & Gaurav Tower (Malviya Nagar), Gopalpura Bypass, Tonk Road frontage.
