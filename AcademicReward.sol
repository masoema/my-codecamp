// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Import library standar dari OpenZeppelin untuk fungsionalitas token
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AcademicReward
 * @dev Smart contract untuk sistem reward akademisi menggunakan token EduCoin
 *
 * KONSEP UTAMA:
 * - Universitas/Admin dapat memberikan reward berupa token kepada dosen/peneliti
 * - Dosen dapat submit achievement dengan bukti (link Google Drive/Dropbox)
 * - Admin memverifikasi dan approve/reject submission
 * - Token dapat digunakan untuk reputasi atau ditukar dengan benefit tertentu
 * - Semua transaksi tercatat di blockchain secara transparan dan tidak dapat diubah
 */
contract AcademicReward is ERC20, Ownable {

    // ===== ENUMS =====

    // Status submission achievement
    enum SubmissionStatus {
        Pending,    // Menunggu verifikasi
        Approved,   // Disetujui dan reward telah diberikan
        Rejected    // Ditolak oleh admin
    }

    // ===== STRUCTS =====

    // Struktur data untuk menyimpan submission achievement
    struct AchievementSubmission {
        uint256 id;                     // ID unik submission
        address teacher;                // Alamat dosen yang submit
        string achievementType;         // Jenis achievement (harus sesuai kategori)
        string description;             // Deskripsi tambahan
        string proofLink;               // Link bukti (Google Drive/Dropbox)
        uint256 submittedAt;            // Waktu submit
        SubmissionStatus status;        // Status submission
        string rejectionReason;         // Alasan jika ditolak
        uint256 reviewedAt;             // Waktu review oleh admin
    }

    // ===== STATE VARIABLES =====

    // Mapping untuk menyimpan kategori achievement dan jumlah reward-nya
    // Contoh: "Published Paper" => 100 token, "Taught Semester" => 50 token
    mapping(string => uint256) public rewardAmounts;

    // Mapping untuk tracking total reward yang diterima setiap akademisi
    mapping(address => uint256) public totalRewardsReceived;

    // Mapping untuk menyimpan riwayat achievement setiap akademisi
    mapping(address => string[]) public achievementHistory;

    // ReentrancyGuard: Lock sederhana untuk mencegah serangan reentrancy
    // Ketika locked=true, fungsi dengan modifier nonReentrant tidak bisa dipanggil
    bool private locked;

    // Counter untuk ID submission (auto-increment)
    uint256 public submissionCounter;

    // Mapping untuk menyimpan semua submission berdasarkan ID
    mapping(uint256 => AchievementSubmission) public submissions;

    // Mapping untuk menyimpan daftar submission ID milik setiap teacher
    mapping(address => uint256[]) public teacherSubmissions;

    // Array untuk menyimpan semua submission ID yang pending (untuk kemudahan admin)
    uint256[] public pendingSubmissions;

    // Mapping untuk tracking index submission di pendingSubmissions array
    mapping(uint256 => uint256) private pendingSubmissionIndex;

    // ===== EVENTS =====

    // Event yang dipancarkan ketika reward diberikan
    event RewardIssued(
        address indexed teacher,      // Alamat penerima reward
        uint256 amount,               // Jumlah token yang diberikan
        string achievementType,       // Jenis pencapaian
        uint256 timestamp             // Waktu pemberian reward
    );

    // Event ketika kategori reward baru ditambahkan atau diubah
    event RewardCategoryUpdated(
        string category,              // Nama kategori
        uint256 amount                // Jumlah token untuk kategori tersebut
    );

    // Event ketika token di-burn (ditukar dengan benefit)
    event TokensBurned(
        address indexed user,         // Pengguna yang membakar token
        uint256 amount,               // Jumlah token yang dibakar
        string reason                 // Alasan pembakaran (benefit yang ditukar)
    );

    // Event ketika teacher submit achievement baru
    event AchievementSubmitted(
        uint256 indexed submissionId, // ID submission
        address indexed teacher,      // Alamat teacher
        string achievementType,       // Jenis achievement
        string proofLink,             // Link bukti
        uint256 timestamp             // Waktu submit
    );

    // Event ketika submission di-approve
    event SubmissionApproved(
        uint256 indexed submissionId, // ID submission
        address indexed teacher,      // Alamat teacher
        uint256 rewardAmount,         // Jumlah reward yang diberikan
        uint256 timestamp             // Waktu approval
    );

    // Event ketika submission di-reject
    event SubmissionRejected(
        uint256 indexed submissionId, // ID submission
        address indexed teacher,      // Alamat teacher
        string reason,                // Alasan penolakan
        uint256 timestamp             // Waktu rejection
    );
    
    // ===== CONSTRUCTOR =====
    
    /**
     * @dev Constructor untuk inisialisasi contract
     * Membuat token dengan nama "EduCoin" dan simbol "EDU"
     * Deployer contract otomatis menjadi owner (Admin Universitas)
     * 
     * PERBAIKAN: Menambahkan parameter msg.sender ke Ownable constructor
     * Ini diperlukan untuk OpenZeppelin v5.0+
     */
    constructor() ERC20("EduCoin", "EDU") Ownable(msg.sender) {
        // Set default reward amounts untuk beberapa kategori umum
        rewardAmounts["Published Paper"] = 100 * 10**decimals();      // 100 EDU
        rewardAmounts["Taught Semester"] = 50 * 10**decimals();       // 50 EDU
        rewardAmounts["Conference Speaker"] = 75 * 10**decimals();    // 75 EDU
        rewardAmounts["Research Grant"] = 200 * 10**decimals();       // 200 EDU
    }
    
    // ===== MODIFIERS =====
    
    /**
     * @dev Modifier untuk mencegah serangan reentrancy
     * Cara kerja:
     * 1. Cek apakah fungsi sedang berjalan (!locked)
     * 2. Lock fungsi (locked = true) agar tidak bisa dipanggil lagi
     * 3. Jalankan fungsi (_)
     * 4. Unlock setelah selesai (locked = false)
     */
    modifier nonReentrant() {
        require(!locked, "ReentrancyGuard: panggilan berulang terdeteksi");
        locked = true;      // Kunci contract
        _;                  // Jalankan fungsi
        locked = false;     // Buka kunci setelah selesai
    }
    
    // ===== ADMIN FUNCTIONS =====
    
    /**
     * @dev Fungsi utama untuk memberikan reward kepada akademisi
     * Hanya owner (Admin Universitas) yang bisa memanggil fungsi ini
     * 
     * @param teacher Alamat wallet dosen/peneliti yang menerima reward
     * @param achievementType Jenis pencapaian (contoh: "Published Paper")
     * 
     * SECURITY: Menggunakan Checks-Effects-Interactions pattern + nonReentrant
     */
    function issueReward(address teacher, string memory achievementType) 
        public 
        onlyOwner 
        nonReentrant 
    {
        // CHECKS: Validasi input dan kondisi
        require(teacher != address(0), "Alamat tidak valid");
        require(rewardAmounts[achievementType] > 0, "Kategori achievement tidak ditemukan");
        
        // Ambil jumlah reward sesuai kategori
        uint256 amount = rewardAmounts[achievementType];
        
        // EFFECTS: Update state variables SEBELUM interaksi eksternal
        // Mint token baru untuk teacher (menambah total supply)
        _mint(teacher, amount);
        
        // Update tracking data
        totalRewardsReceived[teacher] += amount;
        achievementHistory[teacher].push(achievementType);
        
        // INTERACTIONS: Emit event (aman dilakukan di akhir)
        emit RewardIssued(teacher, amount, achievementType, block.timestamp);
    }
    
    /**
     * @dev Fungsi untuk memberikan reward custom dengan jumlah tertentu
     * Berguna untuk kasus khusus yang tidak masuk kategori standar
     * 
     * @param teacher Alamat penerima
     * @param amount Jumlah token yang diberikan
     * @param description Deskripsi pencapaian
     */
    function issueCustomReward(
        address teacher, 
        uint256 amount, 
        string memory description
    ) 
        public 
        onlyOwner 
        nonReentrant 
    {
        // CHECKS: Validasi input
        require(teacher != address(0), "Alamat tidak valid");
        require(amount > 0, "Jumlah harus lebih dari 0");
        
        // EFFECTS: Update state
        _mint(teacher, amount);
        totalRewardsReceived[teacher] += amount;
        achievementHistory[teacher].push(description);
        
        // INTERACTIONS: Emit event
        emit RewardIssued(teacher, amount, description, block.timestamp);
    }
    
    /**
     * @dev Fungsi untuk menambah atau mengubah kategori reward
     * Admin dapat mengatur berapa token untuk setiap jenis pencapaian
     * 
     * @param category Nama kategori (contoh: "Best Teacher Award")
     * @param amount Jumlah token untuk kategori tersebut
     */
    function setRewardCategory(string memory category, uint256 amount) 
        public 
        onlyOwner 
    {
        require(amount > 0, "Jumlah reward harus lebih dari 0");
        rewardAmounts[category] = amount;
        emit RewardCategoryUpdated(category, amount);
    }
    
    // ===== USER FUNCTIONS (TEACHER) =====

    /**
     * @dev Fungsi untuk teacher submit achievement dengan bukti
     * Teacher dapat mengajukan achievement yang akan diverifikasi oleh admin
     *
     * @param achievementType Jenis achievement (harus sesuai kategori yang ada)
     * @param description Deskripsi tambahan tentang achievement
     * @param proofLink Link bukti (Google Drive, Dropbox, dll)
     *
     * ALUR:
     * 1. Teacher memanggil fungsi ini dengan data achievement
     * 2. Submission disimpan dengan status Pending
     * 3. Admin akan review dan approve/reject
     */
    function submitAchievement(
        string memory achievementType,
        string memory description,
        string memory proofLink
    ) public {
        // CHECKS: Validasi input
        require(bytes(achievementType).length > 0, "Jenis achievement tidak boleh kosong");
        require(bytes(proofLink).length > 0, "Link bukti tidak boleh kosong");
        require(rewardAmounts[achievementType] > 0, "Kategori achievement tidak valid");

        // EFFECTS: Buat submission baru
        uint256 submissionId = submissionCounter;
        submissionCounter++;

        AchievementSubmission storage newSubmission = submissions[submissionId];
        newSubmission.id = submissionId;
        newSubmission.teacher = msg.sender;
        newSubmission.achievementType = achievementType;
        newSubmission.description = description;
        newSubmission.proofLink = proofLink;
        newSubmission.submittedAt = block.timestamp;
        newSubmission.status = SubmissionStatus.Pending;

        // Tambahkan ke daftar submission teacher
        teacherSubmissions[msg.sender].push(submissionId);

        // Tambahkan ke daftar pending untuk admin
        pendingSubmissionIndex[submissionId] = pendingSubmissions.length;
        pendingSubmissions.push(submissionId);

        // INTERACTIONS: Emit event
        emit AchievementSubmitted(
            submissionId,
            msg.sender,
            achievementType,
            proofLink,
            block.timestamp
        );
    }

    /**
     * @dev Fungsi untuk menukar token dengan benefit (contoh: tiket konferensi)
     * Token akan di-burn (dihancurkan) setelah ditukar
     *
     * @param amount Jumlah token yang akan dibakar
     * @param benefit Benefit yang ditukar (contoh: "Conference Ticket")
     *
     * SECURITY: Dilindungi dengan nonReentrant modifier
     */
    function redeemTokens(uint256 amount, string memory benefit)
        public
        nonReentrant
    {
        // CHECKS: Validasi balance pengguna
        require(balanceOf(msg.sender) >= amount, "Saldo token tidak cukup");
        require(amount > 0, "Jumlah harus lebih dari 0");

        // EFFECTS: Burn token (mengurangi total supply)
        _burn(msg.sender, amount);

        // INTERACTIONS: Emit event
        emit TokensBurned(msg.sender, amount, benefit);
    }

    // ===== ADMIN VERIFICATION FUNCTIONS =====

    /**
     * @dev Fungsi untuk admin approve submission dan memberikan reward
     * Hanya owner (Admin Universitas) yang bisa memanggil
     *
     * @param submissionId ID submission yang akan di-approve
     *
     * ALUR:
     * 1. Admin review bukti di link yang diberikan
     * 2. Jika valid, admin memanggil fungsi ini
     * 3. Status berubah menjadi Approved
     * 4. Token reward otomatis dikirim ke teacher
     */
    function approveSubmission(uint256 submissionId)
        public
        onlyOwner
        nonReentrant
    {
        // CHECKS: Validasi submission
        AchievementSubmission storage submission = submissions[submissionId];
        require(submission.teacher != address(0), "Submission tidak ditemukan");
        require(submission.status == SubmissionStatus.Pending, "Submission sudah diproses");

        // Ambil jumlah reward
        uint256 rewardAmount = rewardAmounts[submission.achievementType];
        require(rewardAmount > 0, "Kategori reward tidak valid");

        // EFFECTS: Update status submission
        submission.status = SubmissionStatus.Approved;
        submission.reviewedAt = block.timestamp;

        // Hapus dari pending list
        _removeFromPending(submissionId);

        // Mint token untuk teacher
        _mint(submission.teacher, rewardAmount);

        // Update tracking data
        totalRewardsReceived[submission.teacher] += rewardAmount;
        achievementHistory[submission.teacher].push(submission.achievementType);

        // INTERACTIONS: Emit events
        emit SubmissionApproved(
            submissionId,
            submission.teacher,
            rewardAmount,
            block.timestamp
        );

        emit RewardIssued(
            submission.teacher,
            rewardAmount,
            submission.achievementType,
            block.timestamp
        );
    }

    /**
     * @dev Fungsi untuk admin reject submission
     * Hanya owner (Admin Universitas) yang bisa memanggil
     *
     * @param submissionId ID submission yang akan di-reject
     * @param reason Alasan penolakan (wajib diisi)
     */
    function rejectSubmission(uint256 submissionId, string memory reason)
        public
        onlyOwner
    {
        // CHECKS: Validasi submission
        AchievementSubmission storage submission = submissions[submissionId];
        require(submission.teacher != address(0), "Submission tidak ditemukan");
        require(submission.status == SubmissionStatus.Pending, "Submission sudah diproses");
        require(bytes(reason).length > 0, "Alasan penolakan harus diisi");

        // EFFECTS: Update status submission
        submission.status = SubmissionStatus.Rejected;
        submission.rejectionReason = reason;
        submission.reviewedAt = block.timestamp;

        // Hapus dari pending list
        _removeFromPending(submissionId);

        // INTERACTIONS: Emit event
        emit SubmissionRejected(
            submissionId,
            submission.teacher,
            reason,
            block.timestamp
        );
    }

    /**
     * @dev Internal function untuk menghapus submission dari pending list
     * Menggunakan teknik "swap and pop" untuk efisiensi gas
     */
    function _removeFromPending(uint256 submissionId) internal {
        uint256 index = pendingSubmissionIndex[submissionId];
        uint256 lastIndex = pendingSubmissions.length - 1;

        if (index != lastIndex) {
            uint256 lastSubmissionId = pendingSubmissions[lastIndex];
            pendingSubmissions[index] = lastSubmissionId;
            pendingSubmissionIndex[lastSubmissionId] = index;
        }

        pendingSubmissions.pop();
        delete pendingSubmissionIndex[submissionId];
    }
    
    // ===== VIEW FUNCTIONS =====

    /**
     * @dev Melihat riwayat pencapaian seorang akademisi
     * @param teacher Alamat akademisi
     * @return Array berisi daftar pencapaian
     */
    function getAchievementHistory(address teacher)
        public
        view
        returns (string[] memory)
    {
        return achievementHistory[teacher];
    }

    /**
     * @dev Melihat total reward yang pernah diterima
     * @param teacher Alamat akademisi
     * @return Total token yang pernah diterima (termasuk yang sudah di-burn)
     */
    function getTotalRewards(address teacher)
        public
        view
        returns (uint256)
    {
        return totalRewardsReceived[teacher];
    }

    /**
     * @dev Melihat jumlah reward untuk kategori tertentu
     * @param category Nama kategori
     * @return Jumlah token untuk kategori tersebut
     */
    function getRewardAmount(string memory category)
        public
        view
        returns (uint256)
    {
        return rewardAmounts[category];
    }

    /**
     * @dev Melihat detail submission berdasarkan ID
     * @param submissionId ID submission
     * @return Struct AchievementSubmission dengan semua detail
     */
    function getSubmission(uint256 submissionId)
        public
        view
        returns (AchievementSubmission memory)
    {
        return submissions[submissionId];
    }

    /**
     * @dev Melihat semua submission ID milik seorang teacher
     * @param teacher Alamat teacher
     * @return Array berisi submission IDs
     */
    function getTeacherSubmissions(address teacher)
        public
        view
        returns (uint256[] memory)
    {
        return teacherSubmissions[teacher];
    }

    /**
     * @dev Melihat semua submission ID yang masih pending (untuk admin)
     * @return Array berisi submission IDs yang pending
     */
    function getPendingSubmissions()
        public
        view
        returns (uint256[] memory)
    {
        return pendingSubmissions;
    }

    /**
     * @dev Melihat jumlah submission pending
     * @return Jumlah submission yang menunggu review
     */
    function getPendingCount()
        public
        view
        returns (uint256)
    {
        return pendingSubmissions.length;
    }

    /**
     * @dev Melihat detail lengkap semua submission pending (untuk admin dashboard)
     * @return Array berisi struct AchievementSubmission
     */
    function getAllPendingSubmissions()
        public
        view
        returns (AchievementSubmission[] memory)
    {
        uint256 count = pendingSubmissions.length;
        AchievementSubmission[] memory result = new AchievementSubmission[](count);

        for (uint256 i = 0; i < count; i++) {
            result[i] = submissions[pendingSubmissions[i]];
        }

        return result;
    }

    /**
     * @dev Override decimals untuk menggunakan 18 decimal places (standar)
     * Ini berarti 1 token = 1 * 10^18 unit terkecil
     */
    function decimals() public pure override returns (uint8) {
        return 18;
    }
}