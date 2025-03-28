const puppeteer = require('puppeteer');
const { createObjectCsvWriter } = require('csv-writer');
require('dotenv').config();
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});

(async () => {
  try {
    // Lựa chọn menu
    const choice = await new Promise(resolve => {
      readline.question('1.Quét tất cả sản phẩm sàn 2.quét đấu giá: ', answer => {
        readline.close();
        resolve(answer);
      });
    });

    const config = {
      baseUrl: choice === '2' 
        ? 'https://estec-trade.com/products/ongoing-auctions' 
        : 'https://estec-trade.com/product/listing',
      outputFile: choice === '2' 
        ? 'agro_stock_info.csv' 
        : 'agro_stock_ongoing_auctions_info.csv',
      isAuction: choice !== '2'
    };

    console.log(`Bắt đầu quét sản phẩm: ${config.isAuction ? 'Tất cả SP' : 'mục đấu giá'}...`);

    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();

    // Đăng nhập
    console.log('Đang đăng nhập...');
    await page.goto('https://estec-trade.com/site/login', { timeout: 60000 });
    await page.type('#loginform-email', process.env.EMAIL);
    await page.type('#loginform-password', process.env.PASSWORD);
    await page.keyboard.press('Enter');
    await page.waitForNavigation();

    // Lấy danh sách sản phẩm
    console.log('Đang lấy danh sách...');
    await page.goto(`${config.baseUrl}?page=1&per-page=30`);
    
    const products = await page.evaluate(() => 
      Array.from(
        document.querySelectorAll('#w0 > div.col-lg-12.col-xs-12.vertical-view.outer_list > div'),
        item => ({
          title: item.querySelector('h3')?.textContent?.trim() || 'N/A',
          link: item.querySelector('a')?.href || 'N/A'
        })
      ).slice(0, 5)
    );

    // Thu thập chi tiết
    const results = [];
    for (const product of products) {
      const detailPage = await browser.newPage();
      try {
        console.log(`Đang xử lý: ${product.title}`);
        await detailPage.goto(product.link, { timeout: 30000 });
        
        const data = await detailPage.evaluate((isAuction) => {
          // Hàm helper
          const getText = (selector) => 
            document.querySelector(selector)?.textContent?.trim() || 'N/A';
          
          const getHref = (selector) =>
            document.querySelector(selector)?.href || 'N/A';

          if (isAuction) {
            return {
              price: getText('div.product-description-outer h2:nth-child(3) > div'),
              year: getText('ul > li:nth-child(5) > span'),
              hours: getText('ul > li:nth-child(6) > span'),
              stock_id: getText('ul > li:nth-child(2) > span'),
              stockType: getText('ul > li:nth-child(1) > span'),
              downloadLink: getHref('.download-links.product_options_more a'),
              time_end: 'N/A',
              time_left: 'N/A'
            };
          }
          else{
            return {
            stockType: getText('li.full_device.auction-type-detail > span'),
            time_end: getText('ul > li:nth-child(2) > span'),
            time_left: getText('#class-clock-result'),
            price: getText('div > h2:nth-child(3) > div'),
            year: getText('ul > li:nth-child(5) > span'),
            hours: getText('ul > li:nth-child(9) > span'),
            stock_id: getText('ul > li.auction-type-stock > span'),
            downloadLink: getHref('div.col-xs-12.download-links.product_options_more > div:nth-child(1) > a')}
         
           
          };
        }, config.isAuction);

        results.push({ ...product, ...data });
      } catch (error) {
        console.error(`Lỗi: ${product.title}`, error.message);
        results.push({ 
          ...product, 
          error: error.message,
          price: 'Lỗi',
          year: 'Lỗi',
          hours: 'Lỗi'
        });
      } finally {
        await detailPage.close();
      }
    }

    // Xuất CSV
    const csvWriter = createObjectCsvWriter({
      path: config.outputFile,
      header: [
        { id: 'title', title: 'TÊN SẢN PHẨM' },
        { id: 'stock_id', title: 'MÃ SP' },
        { id: 'stockType', title: 'LOẠI' },
        { id: 'price', title: 'GIÁ' },
        { id: 'year', title: 'NĂM' },
        { id: 'hours', title: 'GIỜ' },
        { id: 'time_end', title: 'THỜI GIAN KẾT THÚC' },
        { id: 'time_left', title: 'THỜI GIAN CÒN LẠI' },
        { id: 'link', title: 'LINK' },
        { id: 'downloadLink', title: 'DOWNLOAD LINK' }
      ]
    });
    
    await csvWriter.writeRecords(results);
    console.log(`Hoàn thành! Đã lưu vào ${config.outputFile}`);

  } catch (error) {
    console.error('Lỗi chính:', error);
  } finally {
    await browser.close();
  }
})();