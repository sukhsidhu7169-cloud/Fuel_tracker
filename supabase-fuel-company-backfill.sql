-- Tag legacy 17780613 fuel rows. These van names are unique to that company;
-- rows for 15988357 and any other company are left unchanged.
update fuel_entries
set company = '17780613 Canada Inc.'
where (company is null or btrim(company) = '')
  and van in (
    'Mid Roof',
    'Green Transit',
    'Ford Extended',
    'Odyssey (MAG)',
    'Silver Odyssey',
    'Red Chrysler'
  );
